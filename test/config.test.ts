import { configs, resolveEnv } from '../lib/config';

describe('config profiles', () => {
  it('has the four profiles', () => {
    expect(Object.keys(configs).sort()).toEqual(['dev', 'preview', 'prod', 'stage']);
  });

  it('only the preview profile destroys on delete and skips backups', () => {
    for (const [name, c] of Object.entries(configs)) {
      expect(c.destroyOnDelete).toBe(name === 'preview');
      expect(c.backups).toBe(name !== 'preview');
    }
  });

  it('keeps previews cheap', () => {
    expect(configs.preview.natGateways).toBe(1);
    expect(configs.preview.desiredCount).toBe(1);
    expect(configs.preview.logRetentionDays).toBe(3);
  });

  it('resolves long-lived and preview environments', () => {
    expect(resolveEnv('prod')).toMatchObject({ profile: 'prod', stackName: 'nest-next-prod' });
    expect(resolveEnv('pr-42')).toMatchObject({ profile: 'preview', stackName: 'nest-next-pr-42' });
  });

  it('rejects unknown names', () => {
    expect(() => resolveEnv('pr-')).toThrow(/Unknown environment/);
    expect(() => resolveEnv('qa')).toThrow(/Unknown environment/);
  });
});
