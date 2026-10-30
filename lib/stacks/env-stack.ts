import {
  Annotations,
  CfnOutput,
  Stack,
  StackProps,
  Tags,
  aws_ecr as ecr,
  aws_ecs as ecs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config';
import { Alarms } from '../constructs/alarms';
import { Alb, Domain } from '../constructs/alb';
import { Cache } from '../constructs/cache';
import { Database } from '../constructs/database';
import { REPOSITORY_NAMES } from '../constructs/ecr';
import { MigrationTask } from '../constructs/migration';
import { Network } from '../constructs/network';
import { Secrets } from '../constructs/secrets';
import { Service, httpHealthScript } from '../constructs/service';

export interface EnvStackProps extends StackProps {
  envName: string;
  config: EnvConfig;
  domain?: Domain;
  /** Alarm recipient. */
  alarmEmail?: string;
  /** Image tag the services run. Without one the services start with zero tasks. */
  imageTag?: string;
  /** Image tag of the migration task. Defaults to `imageTag`. */
  migrateImageTag?: string;
}

/** One environment: composes the constructs. */
export class EnvStack extends Stack {
  public readonly network: Network;
  public readonly secrets: Secrets;
  public readonly database: Database;
  public readonly cache: Cache;
  public readonly alb: Alb;
  public readonly cluster: ecs.Cluster;
  public readonly api: Service;
  public readonly web: Service;
  public readonly migration: MigrationTask;
  public readonly alarms: Alarms;
  /** Environment and secrets of the API; the migration task needs the same, the starter validates all of it. */
  public readonly apiEnvironment: Record<string, string>;
  public readonly apiSecrets: Record<string, ecs.Secret>;

  constructor(scope: Construct, id: string, props: EnvStackProps) {
    super(scope, id, props);
    Tags.of(this).add('env', props.envName);
    this.network = new Network(this, 'Network', { natGateways: props.config.natGateways });
    this.secrets = new Secrets(this, 'Secrets', { destroyOnDelete: props.config.destroyOnDelete });
    const { config } = props;
    this.database = new Database(this, 'Database', {
      vpc: this.network.vpc,
      credentials: this.secrets.database,
      instanceClass: config.dbInstanceClass,
      backups: config.backups,
      destroyOnDelete: config.destroyOnDelete,
    });
    this.cache = new Cache(this, 'Cache', {
      vpc: this.network.vpc,
      authToken: this.secrets.redisAuthToken,
      nodeType: config.cacheNodeType,
      highAvailability: config.backups,
      destroyOnDelete: config.destroyOnDelete,
    });

    this.alb = new Alb(this, 'Alb', { vpc: this.network.vpc, domain: props.domain });
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: this.stackName,
      vpc: this.network.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // The starter refuses APP_ENV=prod over http (Secure cookie, https WEB_ORIGIN), so an
    // environment without a domain runs as dev.
    if (!props.domain && (props.envName === 'stage' || props.envName === 'prod')) {
      Annotations.of(this).addWarning(
        `${props.envName} has no domain: the API runs with APP_ENV=dev.`,
      );
    }
    this.apiEnvironment = {
      APP_ENV: props.domain ? 'prod' : 'dev',
      PORT: '4000',
      WEB_ORIGIN: this.alb.origin,
      LOG_LEVEL: 'info',
      KAFKA_ENABLED: 'false',
    };
    this.apiSecrets = {
      DATABASE_URL: ecs.Secret.fromSecretsManager(this.database.url),
      REDIS_URL: ecs.Secret.fromSecretsManager(this.cache.url),
      JWT_ACCESS_SECRET: ecs.Secret.fromSecretsManager(this.secrets.jwt),
    };

    const tag = props.imageTag ?? 'pending';
    const migrateTag = props.migrateImageTag ?? tag;
    const repository = {
      api: ecr.Repository.fromRepositoryName(this, 'ApiRepo', REPOSITORY_NAMES.api),
      web: ecr.Repository.fromRepositoryName(this, 'WebRepo', REPOSITORY_NAMES.web),
    };
    const image = (name: keyof typeof repository, imageTag = tag) =>
      ecs.ContainerImage.fromEcrRepository(repository[name], imageTag);
    // No image yet (first deployment): create the services empty, the deploy workflow rolls them out.
    const desiredCount = props.imageTag ? config.desiredCount : 0;
    const common = {
      cluster: this.cluster,
      desiredCount,
      logRetentionDays: config.logRetentionDays,
      destroyOnDelete: config.destroyOnDelete,
    };

    this.api = new Service(this, 'Api', {
      ...common,
      serviceName: `${this.stackName}-api`,
      image: image('api'),
      port: 4000,
      environment: this.apiEnvironment,
      secrets: this.apiSecrets,
      healthScript: httpHealthScript(4000, '/api/health/live'),
      route: {
        listener: this.alb.listener,
        paths: ['/api/*'],
        priority: 10,
        healthCheckPath: '/api/health/live',
      },
    });
    this.web = new Service(this, 'Web', {
      ...common,
      serviceName: `${this.stackName}-web`,
      image: image('web'),
      port: 3000,
      healthScript: httpHealthScript(3000, '/sign-in'),
      route: {
        listener: this.alb.listener,
        paths: ['/*'],
        priority: 100,
        healthCheckPath: '/sign-in',
      },
    });

    this.migration = new MigrationTask(this, 'Migration', {
      vpc: this.network.vpc,
      family: `${this.stackName}-migrate`,
      image: image('api', migrateTag),
      environment: this.apiEnvironment,
      secrets: this.apiSecrets,
      logRetentionDays: config.logRetentionDays,
      destroyOnDelete: config.destroyOnDelete,
    });

    this.database.connections.allowDefaultPortFrom(this.migration.securityGroup);
    this.database.connections.allowDefaultPortFrom(this.api.service);
    this.cache.connections.allowDefaultPortFrom(this.api.service);

    this.alarms = new Alarms(this, 'Alarms', {
      cluster: this.cluster,
      loadBalancer: this.alb.loadBalancer,
      services: [
        { name: 'Api', service: this.api.service, expectedTasks: desiredCount },
        { name: 'Web', service: this.web.service, expectedTasks: desiredCount },
      ],
      database: this.database.instance,
      email: props.alarmEmail,
    });

    // Read by the deploy workflow to build images, run the migration and smoke-test.
    new CfnOutput(this, 'Origin', { value: this.alb.origin });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'MigrationTaskDefinition', { value: this.migration.taskDefinition.family });
    new CfnOutput(this, 'MigrationSecurityGroup', {
      value: this.migration.securityGroup.securityGroupId,
    });
    new CfnOutput(this, 'PrivateSubnets', {
      value: this.network.vpc.privateSubnets.map((s) => s.subnetId).join(','),
    });
  }
}
