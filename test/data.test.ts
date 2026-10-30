import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { configs, EnvConfig } from '../lib/config';
import { Cache } from '../lib/constructs/cache';
import { Database } from '../lib/constructs/database';
import { Network } from '../lib/constructs/network';
import { Secrets } from '../lib/constructs/secrets';

const synth = (c: EnvConfig) => {
  const stack = new Stack(new App(), 'Test');
  const { vpc } = new Network(stack, 'Network', { natGateways: c.natGateways });
  const secrets = new Secrets(stack, 'Secrets', { destroyOnDelete: c.destroyOnDelete });
  new Database(stack, 'Database', {
    vpc,
    credentials: secrets.database,
    instanceClass: c.dbInstanceClass,
    backups: c.backups,
    destroyOnDelete: c.destroyOnDelete,
  });
  new Cache(stack, 'Cache', {
    vpc,
    authToken: secrets.redisAuthToken,
    nodeType: c.cacheNodeType,
    highAvailability: c.backups,
    destroyOnDelete: c.destroyOnDelete,
  });
  return Template.fromStack(stack);
};

describe('Database', () => {
  const t = synth(configs.prod);

  it('is private, encrypted and requires TLS', () => {
    t.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DBInstanceClass: 'db.t4g.medium',
    });
    t.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: Match.objectLike({ 'rds.force_ssl': '1' }),
    });
  });

  it('keeps backups and protection outside previews and drops them for previews', () => {
    synth(configs.prod).hasResourceProperties('AWS::RDS::DBInstance', {
      BackupRetentionPeriod: 7,
      DeletionProtection: true,
    });
    const preview = synth(configs.preview);
    preview.hasResourceProperties('AWS::RDS::DBInstance', {
      BackupRetentionPeriod: 0,
      DeletionProtection: false,
    });
    expect(Object.values(preview.findResources('AWS::RDS::DBInstance'))[0].DeletionPolicy).toBe(
      'Delete',
    );
    expect(Object.values(t.findResources('AWS::RDS::DBInstance'))[0].DeletionPolicy).toBe(
      'Snapshot',
    );
  });

  it('builds DATABASE_URL from dynamic references, never from a value', () => {
    const urls = Object.values(t.findResources('AWS::SecretsManager::Secret')).filter((s) =>
      JSON.stringify(s.Properties).includes('sslmode=no-verify'),
    );
    expect(urls).toHaveLength(1);
    expect(JSON.stringify(urls[0].Properties.SecretString)).toContain('{{resolve:secretsmanager:');
  });
});

describe('Cache', () => {
  it('has TLS, encryption at rest and AUTH', () => {
    synth(configs.prod).hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      TransitEncryptionEnabled: true,
      AtRestEncryptionEnabled: true,
      AuthToken: Match.anyValue(),
      AutomaticFailoverEnabled: true,
      NumCacheClusters: 2,
    });
  });

  it('runs a single node in previews and is destroyed with them', () => {
    const t = synth(configs.preview);
    t.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      NumCacheClusters: 1,
      AutomaticFailoverEnabled: false,
    });
    expect(
      Object.values(t.findResources('AWS::ElastiCache::ReplicationGroup'))[0].DeletionPolicy,
    ).toBe('Delete');
  });

  it('is only reachable from inside, with no open ingress', () => {
    const t = synth(configs.prod);
    const groups = t.findResources('AWS::EC2::SecurityGroup');
    for (const g of Object.values(groups)) {
      expect(JSON.stringify(g.Properties.SecurityGroupIngress ?? [])).not.toContain('0.0.0.0/0');
    }
  });

  it('builds REDIS_URL with rediss and a dynamic reference', () => {
    const t = synth(configs.prod);
    const url = Object.values(t.findResources('AWS::SecretsManager::Secret')).find((s) =>
      JSON.stringify(s.Properties).includes('rediss://'),
    );
    expect(JSON.stringify(url?.Properties.SecretString)).toContain('{{resolve:secretsmanager:');
  });
});
