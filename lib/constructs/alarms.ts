import {
  Duration,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as actions,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam,
  aws_kms as kms,
  aws_rds as rds,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface MonitoredService {
  name: string;
  service: ecs.FargateService;
  /** Tasks that should be running. Zero before the first image exists: no task alarm then. */
  expectedTasks: number;
}

export interface AlarmsProps {
  cluster: ecs.ICluster;
  loadBalancer: elbv2.IApplicationLoadBalancer;
  services: MonitoredService[];
  database: rds.IDatabaseInstance;
  /** Optional recipient; without one the topic exists and can be subscribed to later. */
  email?: string;
}

const PERIOD = Duration.minutes(5);
const MIB = 1024 * 1024;

/** One SNS topic and the alarms that publish to it: 5xx, CPU, memory, running tasks, RDS. */
export class Alarms extends Construct {
  public readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: AlarmsProps) {
    super(scope, id);

    // CloudWatch can publish to a topic only when the key policy lets it use the key.
    const key = new kms.Key(this, 'Key', { enableKeyRotation: true });
    key.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
        resources: ['*'], // in a key policy "*" means this key
      }),
    );
    this.topic = new sns.Topic(this, 'Topic', {
      displayName: 'nest-next alarms',
      masterKey: key,
      enforceSSL: true,
    });
    if (props.email) this.topic.addSubscription(new subscriptions.EmailSubscription(props.email));

    const alarm = (
      name: string,
      metric: cloudwatch.IMetric,
      props2: Partial<cloudwatch.AlarmProps>,
    ) =>
      new cloudwatch.Alarm(this, name, {
        metric,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        threshold: 0,
        ...props2,
      }).addAlarmAction(new actions.SnsAction(this.topic));

    alarm(
      'Alb5xx',
      props.loadBalancer.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: PERIOD }),
      {
        alarmDescription: 'The load balancer itself returned 5xx.',
        threshold: 5,
      },
    );
    alarm(
      'Target5xx',
      props.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: PERIOD,
      }),
      { alarmDescription: 'The services returned 5xx.', threshold: 5 },
    );

    for (const { name, service, expectedTasks } of props.services) {
      alarm(`${name}Cpu`, service.metricCpuUtilization({ period: PERIOD }), {
        alarmDescription: `${name} CPU is high.`,
        threshold: 80,
        evaluationPeriods: 3,
      });
      alarm(`${name}Memory`, service.metricMemoryUtilization({ period: PERIOD }), {
        alarmDescription: `${name} memory is high.`,
        threshold: 80,
        evaluationPeriods: 3,
      });
      if (expectedTasks > 0) {
        alarm(
          `${name}Tasks`,
          new cloudwatch.Metric({
            namespace: 'ECS/ContainerInsights',
            metricName: 'RunningTaskCount',
            dimensionsMap: {
              ClusterName: props.cluster.clusterName,
              ServiceName: service.serviceName,
            },
            statistic: 'Minimum',
            period: PERIOD,
          }),
          {
            alarmDescription: `${name} runs fewer tasks than expected.`,
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            threshold: expectedTasks,
            evaluationPeriods: 2,
            treatMissingData: cloudwatch.TreatMissingData.BREACHING,
          },
        );
      }
    }

    alarm('DatabaseCpu', props.database.metricCPUUtilization({ period: PERIOD }), {
      alarmDescription: 'Database CPU is high.',
      threshold: 80,
      evaluationPeriods: 3,
    });
    alarm('DatabaseStorage', props.database.metricFreeStorageSpace({ period: PERIOD }), {
      alarmDescription: 'Database has less than 2 GiB of free storage.',
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      threshold: 2048 * MIB,
    });
    alarm('DatabaseMemory', props.database.metricFreeableMemory({ period: PERIOD }), {
      alarmDescription: 'Database has less than 128 MiB of freeable memory.',
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      threshold: 128 * MIB,
      evaluationPeriods: 3,
    });
  }
}
