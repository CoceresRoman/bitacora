import { CuratorService, scoreSignal, TOPIC_COOLDOWN_DAYS } from './curator.service';
import { RawSignal, SignalSource } from '../core/signal.entity';
import { SourcePort } from '../core/ports/source.port';
import { SignalRepository } from '../persistence/signal.repository';
import { DraftRepository } from '../persistence/draft.repository';

const NOW = new Date('2026-08-04T12:00:00Z');

function signal(source: SignalSource, payload: string, capturedAt = NOW): RawSignal {
  return { id: `${source}-${payload}`, source, kind: 'k', payload, refs: [], capturedAt, hash: payload };
}

describe('scoreSignal', () => {
  it('ranks an inbox idea above a commit and a commit above a trend', () => {
    const inbox = scoreSignal(signal('inbox', 'idea'), [], NOW);
    const git = scoreSignal(signal('git', 'commit'), [], NOW);
    const trends = scoreSignal(signal('trends', 'trend'), [], NOW);
    expect(inbox).toBeGreaterThan(git);
    expect(git).toBeGreaterThan(trends);
  });

  it('rewards recency', () => {
    const old = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(scoreSignal(signal('git', 'x'), [], NOW)).toBeGreaterThan(
      scoreSignal(signal('git', 'x', old), [], NOW),
    );
  });

  it('vetoes a signal whose topic was covered recently', () => {
    expect(scoreSignal(signal('git', 'retry backoff en la cola'), ['backoff'], NOW)).toBeLessThan(0);
  });

  it('ignores short common words when matching topics', () => {
    expect(scoreSignal(signal('git', 'algo sobre la cola'), ['de'], NOW)).toBeGreaterThan(0);
  });
});

describe('CuratorService.pickBest', () => {
  const service = new CuratorService([], {} as SignalRepository, {} as DraftRepository);

  it('returns the highest scoring candidate', () => {
    const best = service.pickBest(
      [signal('trends', 'trend'), signal('inbox', 'idea propia')],
      [],
      NOW,
    );
    expect(best?.source).toBe('inbox');
  });

  it('returns null when every candidate is vetoed', () => {
    expect(service.pickBest([signal('git', 'retry backoff')], ['backoff'], NOW)).toBeNull();
  });

  it('returns null on an empty candidate list', () => {
    expect(service.pickBest([], [], NOW)).toBeNull();
  });
});

describe('CuratorService.collect', () => {
  it('persists only signals whose hash is unseen and returns those', async () => {
    const fresh = signal('git', 'nuevo');
    const sources: SourcePort[] = [
      { source: 'git', collect: async () => [fresh, signal('git', 'repetido')] },
    ];
    const saved: RawSignal[][] = [];
    const signalRepo = {
      saveNew: async (items: RawSignal[]) => {
        saved.push(items);
        return [fresh];
      },
    } as unknown as SignalRepository;

    const service = new CuratorService(sources, signalRepo, {} as DraftRepository);
    const result = await service.collect(new Date(0));

    expect(saved[0]).toHaveLength(2);
    expect(result).toEqual([fresh]);
  });

  it('keeps going when one source throws', async () => {
    const sources: SourcePort[] = [
      {
        source: 'trends',
        collect: async () => {
          throw new Error('network down');
        },
      },
      { source: 'git', collect: async () => [signal('git', 'ok')] },
    ];
    const signalRepo = {
      saveNew: async (items: RawSignal[]) => items,
    } as unknown as SignalRepository;

    const result = await new CuratorService(sources, signalRepo, {} as DraftRepository).collect(
      new Date(0),
    );
    expect(result.map((s: RawSignal) => s.payload)).toEqual(['ok']);
  });
});

describe('CuratorService.pendingSignals', () => {
  it('returns the full unused backlog from the signal repository', async () => {
    const backlog = [signal('git', 'from tuesday')];
    const signalRepo = {
      findUnused: async () => backlog,
    } as unknown as SignalRepository;

    const service = new CuratorService([], signalRepo, {} as DraftRepository);
    const result = await service.pendingSignals();

    expect(result).toEqual(backlog);
  });
});

describe('TOPIC_COOLDOWN_DAYS', () => {
  it('is two weeks', () => {
    expect(TOPIC_COOLDOWN_DAYS).toBe(14);
  });
});
