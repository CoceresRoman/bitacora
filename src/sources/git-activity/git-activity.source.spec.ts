import { GitActivitySource } from './git-activity.source';
import { GitCommit, LocalGitReader } from './local-git.reader';
import { GithubEventsReader } from './github-events.reader';

const commit = (sha: string, subject: string): GitCommit => ({
  repo: 'bitacora',
  sha,
  subject,
  body: '',
  at: new Date('2026-08-03T10:00:00Z'),
});

function source(local: GitCommit[], remote: GitCommit[]): GitActivitySource {
  const localReader = { read: async () => local } as unknown as LocalGitReader;
  const remoteReader = { read: async () => remote } as unknown as GithubEventsReader;
  return new GitActivitySource(localReader, remoteReader, {
    username: 'CoceresRoman',
    repoPaths: ['/repo'],
  });
}

describe('GitActivitySource', () => {
  it('declares the git source', () => {
    expect(source([], []).source).toBe('git');
  });

  it('produces one signal per commit with a stable hash and refs', async () => {
    const signals = await source([commit('abc', 'feat: add guard')], []).collect(new Date(0));
    expect(signals).toHaveLength(1);
    expect(signals[0].source).toBe('git');
    expect(signals[0].kind).toBe('commit');
    expect(signals[0].payload).toContain('feat: add guard');
    expect(signals[0].refs).toEqual(['bitacora@abc']);
    expect(signals[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deduplicates a commit reported by both readers', async () => {
    const same = commit('abc', 'feat: add guard');
    const signals = await source([same], [same]).collect(new Date(0));
    expect(signals).toHaveLength(1);
  });

  it('drops noise commits', async () => {
    const signals = await source(
      [commit('a1', 'chore: bump deps'), commit('a2', 'Merge branch main')],
      [],
    ).collect(new Date(0));
    expect(signals).toEqual([]);
  });
});
