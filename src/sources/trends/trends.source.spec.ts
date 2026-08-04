import { TrendsSource } from './trends.source';

const HN_RESPONSE = {
  hits: [
    { objectID: '1', title: 'Node.js 24 released', url: 'https://nodejs.org', points: 350 },
    { objectID: '2', title: 'Low signal post', url: 'https://example.com', points: 12 },
  ],
};

const RELEASE_RESPONSE = {
  tag_name: 'v11.1.0',
  name: 'v11.1.0',
  body: 'Adds scoped module resolution.',
  html_url: 'https://github.com/nestjs/nest/releases/tag/v11.1.0',
  published_at: '2026-08-03T09:00:00Z',
};

describe('TrendsSource', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stub(handler: (url: string) => unknown) {
    globalThis.fetch = jest.fn(async (input: unknown) => ({
      ok: true,
      json: async () => handler(String(input)),
    })) as unknown as typeof fetch;
  }

  it('declares the trends source', () => {
    expect(new TrendsSource({ repos: [] }).source).toBe('trends');
  });

  it('keeps only high-signal Hacker News stories', async () => {
    stub((url) => (url.includes('algolia') ? HN_RESPONSE : RELEASE_RESPONSE));
    const signals = await new TrendsSource({ repos: [] }).collect(new Date(0));
    const titles = signals.map((s) => s.payload);
    expect(titles.some((t) => t.includes('Node.js 24 released'))).toBe(true);
    expect(titles.some((t) => t.includes('Low signal post'))).toBe(false);
  });

  it('emits a signal per configured repo release, newer than the cutoff', async () => {
    stub((url) => (url.includes('algolia') ? { hits: [] } : RELEASE_RESPONSE));
    const signals = await new TrendsSource({ repos: ['nestjs/nest'] }).collect(
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('release');
    expect(signals[0].refs).toEqual([
      'https://github.com/nestjs/nest/releases/tag/v11.1.0',
    ]);
  });

  it('drops releases older than the cutoff', async () => {
    stub((url) => (url.includes('algolia') ? { hits: [] } : RELEASE_RESPONSE));
    const signals = await new TrendsSource({ repos: ['nestjs/nest'] }).collect(
      new Date('2026-08-04T00:00:00Z'),
    );
    expect(signals).toEqual([]);
  });

  it('returns an empty list instead of throwing when the network fails', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('ENETDOWN')) as unknown as typeof fetch;
    const signals = await new TrendsSource({ repos: ['nestjs/nest'] }).collect(new Date(0));
    expect(signals).toEqual([]);
  });
});
