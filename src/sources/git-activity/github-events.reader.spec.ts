import { GithubEventsReader } from './github-events.reader';

const PUSH_EVENT = {
  type: 'PushEvent',
  created_at: '2026-08-03T10:00:00Z',
  repo: { name: 'CoceresRoman/bitacora' },
  payload: {
    commits: [
      { sha: 'abc123', message: 'feat: add style guard' },
      { sha: 'def456', message: 'chore: bump deps' },
    ],
  },
};

describe('GithubEventsReader', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps push event commits to GitCommit', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [PUSH_EVENT],
    }) as unknown as typeof fetch;

    const commits = await new GithubEventsReader().read(
      'CoceresRoman',
      new Date('2026-08-01T00:00:00Z'),
    );

    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      repo: 'CoceresRoman/bitacora',
      sha: 'abc123',
      subject: 'feat: add style guard',
    });
  });

  it('drops events older than the cutoff', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [PUSH_EVENT],
    }) as unknown as typeof fetch;

    const commits = await new GithubEventsReader().read(
      'CoceresRoman',
      new Date('2026-08-04T00:00:00Z'),
    );
    expect(commits).toEqual([]);
  });

  it('returns an empty list when GitHub responds with an error', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    const commits = await new GithubEventsReader().read('CoceresRoman', new Date(0));
    expect(commits).toEqual([]);
  });
});
