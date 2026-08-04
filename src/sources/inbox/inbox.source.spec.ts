import { InboxSource } from './inbox.source';
import { SignalRepository } from '../../persistence/signal.repository';
import { RawSignal } from '../../core/signal.entity';

function fakeRepo() {
  const stored: RawSignal[] = [];
  return {
    stored,
    repo: {
      saveNew: async (signals: RawSignal[]) => {
        const fresh = signals.filter((s) => !stored.some((e) => e.hash === s.hash));
        fresh.forEach((s, i) => stored.push({ ...s, id: `i${stored.length + i}` }));
        return fresh;
      },
      findUnused: async () => stored,
      markUsed: async () => undefined,
    } as unknown as SignalRepository,
  };
}

const NOW = new Date('2026-08-04T12:00:00Z');

describe('InboxSource', () => {
  it('declares the inbox source', () => {
    expect(new InboxSource(fakeRepo().repo).source).toBe('inbox');
  });

  it('stores a captured idea as an inbox signal', async () => {
    const { repo, stored } = fakeRepo();
    await new InboxSource(repo).capture('idea: contar el bug del backoff', NOW);
    expect(stored).toHaveLength(1);
    expect(stored[0].source).toBe('inbox');
    expect(stored[0].kind).toBe('idea');
    expect(stored[0].payload).toBe('idea: contar el bug del backoff');
    expect(stored[0].capturedAt).toEqual(NOW);
  });

  it('rejects an empty idea', async () => {
    const { repo } = fakeRepo();
    await expect(new InboxSource(repo).capture('   ', NOW)).rejects.toThrow(/empty/i);
  });

  it('collect returns only unused inbox signals', async () => {
    const { repo } = fakeRepo();
    const source = new InboxSource(repo);
    await source.capture('idea uno', NOW);
    await source.capture('idea dos', NOW);
    const collected = await source.collect(new Date(0));
    expect(collected.map((s) => s.payload)).toEqual(['idea uno', 'idea dos']);
  });
});
