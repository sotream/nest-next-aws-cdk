import {
  Duration,
  RemovalPolicy,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { acknowledgeTaskDefinition } from '../nag';

export interface ServiceRoute {
  listener: elbv2.IApplicationListener;
  /** Path patterns, e.g. `/api/*`. */
  paths: string[];
  priority: number;
  healthCheckPath: string;
}

export interface ServiceProps {
  cluster: ecs.ICluster;
  /** Fixed so the deploy workflow can ask ECS which image runs now. */
  serviceName: string;
  image: ecs.ContainerImage;
  port: number;
  desiredCount: number;
  logRetentionDays: number;
  destroyOnDelete: boolean;
  environment?: Record<string, string>;
  /** Secrets Manager secrets. The execution role is granted read on each one by `ecs.Secret`. */
  secrets?: Record<string, ecs.Secret>;
  /** Container health check: a node one-liner that exits 0 when healthy. */
  healthScript: string;
  route: ServiceRoute;
  cpu?: number;
  memoryMiB?: number;
}

/** Fargate service with its task definition, log group, health check and ALB rule. */
export class Service extends Construct {
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: ServiceProps) {
    super(scope, id);

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: props.cpu ?? 256,
      memoryLimitMiB: props.memoryMiB ?? 512,
    });
    this.taskDefinition.addContainer('app', {
      image: props.image,
      portMappings: [{ containerPort: props.port }],
      environment: props.environment,
      secrets: props.secrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: id.toLowerCase(),
        logGroup: new logs.LogGroup(this, 'Logs', {
          retention: props.logRetentionDays as logs.RetentionDays,
          removalPolicy: props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        }),
      }),
      healthCheck: {
        command: ['CMD', 'node', '-e', props.healthScript],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    });

    acknowledgeTaskDefinition(this.taskDefinition);

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      serviceName: props.serviceName,
      taskDefinition: this.taskDefinition,
      desiredCount: props.desiredCount,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    props.route.listener.addTargets(id, {
      port: props.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      priority: props.route.priority,
      conditions: [elbv2.ListenerCondition.pathPatterns(props.route.paths)],
      healthCheck: { path: props.route.healthCheckPath, healthyHttpCodes: '200' },
      deregistrationDelay: Duration.seconds(30),
    });
  }
}

/** A `node -e` health script that GETs a local URL and exits 0 on a 2xx. */
export function httpHealthScript(port: number, path: string): string {
  return `fetch('http://127.0.0.1:${port}${path}').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`;
}
