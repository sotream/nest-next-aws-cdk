export type EnvName = 'dev' | 'stage' | 'prod' | 'preview';

export interface EnvConfig {
  /** Number of NAT gateways. Previews use one to stay cheap. */
  natGateways: number;
  /** Desired task count per ECS service. */
  desiredCount: number;
  dbInstanceClass: string;
  cacheNodeType: string;
  logRetentionDays: number;
  /** Multi-AZ database and a Redis replica with failover. */
  highAvailability: boolean;
  /** Backups and deletion protection for the database. */
  backups: boolean;
  /** Only previews may be destroyed with their stack. */
  destroyOnDelete: boolean;
  /** Optional public domain; empty means the ALB DNS name is used. */
  domainName?: string;
}

export const configs: Record<EnvName, EnvConfig> = {
  dev: {
    natGateways: 1,
    desiredCount: 1,
    dbInstanceClass: 'db.t4g.micro',
    cacheNodeType: 'cache.t4g.micro',
    logRetentionDays: 7,
    highAvailability: false,
    backups: true,
    destroyOnDelete: false,
  },
  stage: {
    natGateways: 2,
    desiredCount: 2,
    dbInstanceClass: 'db.t4g.small',
    cacheNodeType: 'cache.t4g.small',
    logRetentionDays: 14,
    highAvailability: true,
    backups: true,
    destroyOnDelete: false,
  },
  prod: {
    natGateways: 2,
    desiredCount: 2,
    dbInstanceClass: 'db.t4g.medium',
    cacheNodeType: 'cache.t4g.medium',
    logRetentionDays: 30,
    highAvailability: true,
    backups: true,
    destroyOnDelete: false,
  },
  preview: {
    natGateways: 1,
    desiredCount: 1,
    dbInstanceClass: 'db.t4g.micro',
    cacheNodeType: 'cache.t4g.micro',
    logRetentionDays: 3,
    highAvailability: false,
    backups: false,
    destroyOnDelete: true,
  },
};

const PREVIEW = /^pr-(\d+)$/;

/** Resolves an environment name (`dev`, `stage`, `prod` or `pr-<number>`) to its profile. */
export function resolveEnv(name: string): {
  profile: EnvName;
  config: EnvConfig;
  stackName: string;
} {
  if (name === 'dev' || name === 'stage' || name === 'prod') {
    return { profile: name, config: configs[name], stackName: `nest-next-${name}` };
  }
  const match = PREVIEW.exec(name);
  if (match) {
    return { profile: 'preview', config: configs.preview, stackName: `nest-next-pr-${match[1]}` };
  }
  throw new Error(`Unknown environment "${name}". Use dev, stage, prod or pr-<number>.`);
}
