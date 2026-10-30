import { aws_ec2 as ec2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface NetworkProps {
  natGateways: number;
}

/** VPC over 2 AZs with public and private (egress through NAT) subnets. */
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
  }
}
