import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalGitReader } from './local-git.reader';

describe('LocalGitReader', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'bitacora-git-'));
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'a.txt'), 'hello');
    git(['add', '.']);
    git(['commit', '-m', 'feat: add retry backoff to the publish queue']);
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('reads commits newer than the cutoff', async () => {
    const commits = await new LocalGitReader().read([repo], new Date('2020-01-01T00:00:00Z'));
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('feat: add retry backoff to the publish queue');
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0].at).toBeInstanceOf(Date);
  });

  it('returns nothing when the cutoff is in the future', async () => {
    const commits = await new LocalGitReader().read([repo], new Date('2999-01-01T00:00:00Z'));
    expect(commits).toEqual([]);
  });

  it('skips a path that is not a git repository instead of throwing', async () => {
    const commits = await new LocalGitReader().read(
      ['/nonexistent-path-xyz'],
      new Date('2020-01-01T00:00:00Z'),
    );
    expect(commits).toEqual([]);
  });
});
