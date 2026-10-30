import { RemovalPolicy, aws_ec2 as ec2, aws_logs as logs } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface NetworkProps {
  natGateways: number;
  logRetentionDays: number;
  destroyOnDelete: boolean;
}

/** VPC over 2 AZs with public and private (egress through NAT) subnets and flow logs. */
export class Network extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: props.natGateways,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, 'FlowLogs', {
          retention: props.logRetentionDays as logs.RetentionDays,
          removalPolicy: props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        }),
      ),
    });
  }
}
