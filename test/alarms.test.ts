import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { resolveEnv } from '../lib/config';
import { EnvStack } from '../lib/stacks/env-stack';

const synth = (env: string, props: { imageTag?: string; alarmEmail?: string } = {}) => {
  const { config, stackName } = resolveEnv(env);
  return Template.fromStack(
    new EnvStack(new App(), stackName, { envName: env, config, stackName, ...props }),
  );
};

const metricNames = (t: Template) =>
  Object.values(t.findResources('AWS::CloudWatch::Alarm')).map(
    (a) => a.Properties.MetricName as string,
  );

describe('alarms', () => {
  const t = synth('prod', { imageTag: 'abc' });

  it('covers 5xx, CPU, memory, running tasks and the database', () => {
    const names = metricNames(t);
    const count = (n: string) => names.filter((x) => x === n).length;
    expect(count('HTTPCode_ELB_5XX_Count')).toBe(1);
    expect(count('HTTPCode_Target_5XX_Count')).toBe(1);
    expect(count('CPUUtilization')).toBe(3); // api, web, database
    expect(count('MemoryUtilization')).toBe(2);
    expect(count('RunningTaskCount')).toBe(2);
    expect(count('FreeStorageSpace')).toBe(1);
    expect(count('FreeableMemory')).toBe(1);
  });

  it('sends every alarm to the topic', () => {
    const alarms = Object.values(t.findResources('AWS::CloudWatch::Alarm'));
    expect(alarms).toHaveLength(11);
    for (const a of alarms) {
      expect(a.Properties.AlarmActions).toHaveLength(1);
      expect(JSON.stringify(a.Properties.AlarmActions)).toContain('AlarmsTopic');
    }
  });

  it('alarms when fewer tasks than desired run, and treats missing data as a breach', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'RunningTaskCount',
      ComparisonOperator: 'LessThanThreshold',
      Threshold: 2,
      TreatMissingData: 'breaching',
    });
  });

  it('has no task alarm before the first image, when the services run zero tasks', () => {
    expect(metricNames(synth('dev'))).not.toContain('RunningTaskCount');
  });

  it('encrypts the topic with a rotating key CloudWatch may use and requires TLS', () => {
    t.hasResourceProperties('AWS::SNS::Topic', { KmsMasterKeyId: Match.anyValue() });
    t.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    t.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectLike({ Principal: { Service: 'cloudwatch.amazonaws.com' } }),
        ]),
      },
    });
    t.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            Effect: 'Deny',
          }),
        ]),
      },
    });
  });

  it('subscribes the alarm email only when one is configured', () => {
    t.resourceCountIs('AWS::SNS::Subscription', 0);
    synth('prod', { imageTag: 'abc', alarmEmail: 'ops@example.com' }).hasResourceProperties(
      'AWS::SNS::Subscription',
      { Protocol: 'email', Endpoint: 'ops@example.com' },
    );
  });
});
