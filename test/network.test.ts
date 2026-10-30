import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { configs } from '../lib/config';
import { Network } from '../lib/constructs/network';

const synth = (natGateways: number) => {
  const stack = new Stack(new App(), 'Test', {
    env: { account: '111111111111', region: 'eu-central-1' },
  });
  new Network(stack, 'Network', { natGateways });
  return Template.fromStack(stack);
};

describe('Network', () => {
  it('creates one VPC with two public and two private subnets', () => {
    const t = synth(1);
    t.resourceCountIs('AWS::EC2::VPC', 1);
    t.resourceCountIs('AWS::EC2::Subnet', 4);
    t.resourcePropertiesCountIs('AWS::EC2::Subnet', { MapPublicIpOnLaunch: true }, 2);
  });

  it.each(Object.entries(configs))('creates the NAT count of the %s profile', (_name, c) => {
    synth(c.natGateways).resourceCountIs('AWS::EC2::NatGateway', c.natGateways);
  });
});
