import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const NOW = Date.parse('2026-10-30T12:00:00Z') / 1000;

const select = (stacks: object[]) => {
  const result = spawnSync(join(__dirname, '../scripts/select-orphaned-previews.sh'), {
    input: JSON.stringify(stacks),
    encoding: 'utf8',
    env: { ...process.env, NOW: String(NOW), MAX_AGE_DAYS: '7' },
  });
  expect(result.status).toBe(0);
  return result.stdout.split('\n').filter(Boolean);
};

const stack = (name: string, createdAt: string, prState: string) => ({ name, createdAt, prState });

describe('select-orphaned-previews.sh', () => {
  it('keeps the previews of open, recent pull requests', () => {
    expect(select([stack('nest-next-pr-1', '2026-10-29T10:00:00.123000+00:00', 'OPEN')])).toEqual(
      [],
    );
  });

  it.each(['CLOSED', 'MERGED'])('selects a preview whose pull request is %s', (state) => {
    expect(select([stack('nest-next-pr-2', '2026-10-30T10:00:00+00:00', state)])).toEqual([
      'nest-next-pr-2',
    ]);
  });

  it('selects an open pull request that is older than seven days', () => {
    expect(select([stack('nest-next-pr-3', '2026-10-22T11:59:59.500000+00:00', 'OPEN')])).toEqual([
      'nest-next-pr-3',
    ]);
    expect(select([stack('nest-next-pr-4', '2026-10-23T12:00:01+00:00', 'OPEN')])).toEqual([]);
  });

  it('handles several stacks', () => {
    expect(
      select([
        stack('nest-next-pr-5', '2026-10-30T10:00:00+00:00', 'OPEN'),
        stack('nest-next-pr-6', '2026-10-30T10:00:00+00:00', 'CLOSED'),
        stack('nest-next-pr-7', '2026-10-01T10:00:00+00:00', 'OPEN'),
      ]),
    ).toEqual(['nest-next-pr-6', 'nest-next-pr-7']);
  });
});
