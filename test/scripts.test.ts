import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const check = (diff: string, allow = false) =>
  spawnSync(join(__dirname, '../scripts/check-db-replacement.sh'), {
    input: diff,
    encoding: 'utf8',
    env: { ...process.env, ALLOW_DB_REPLACEMENT: String(allow) },
  });

describe('check-db-replacement.sh', () => {
  const replace =
    '[~] AWS::RDS::DBInstance Database/Instance/Resource DatabaseInstanceAA8A5FDE replace';
  const destroy =
    '[-] AWS::RDS::DBInstance Database/Instance/Resource DatabaseInstanceAA8A5FDE destroy';

  it('passes a diff that leaves the database alone', () => {
    expect(check('[~] AWS::ECS::Service Api/Service replace').status).toBe(0);
    expect(check('[~] AWS::RDS::DBInstance Database/Instance/Resource update').status).toBe(0);
  });

  it.each([replace, destroy])('blocks %s', (line) => {
    const result = check(`Resources\n${line}\n`);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('would replace or delete the database');
  });

  it('lets a replacement through when allowed', () => {
    expect(check(replace, true).status).toBe(0);
  });
});
