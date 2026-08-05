import { CycleService } from './cycle.service';
import { CuratorService } from '../curator/curator.service';
import { GeneratorService } from '../generator/generator.service';
import { ReviewChannelPort } from '../core/ports/review-channel.port';
import { SignalRepository } from '../persistence/signal.repository';
import { DraftRepository } from '../persistence/draft.repository';
import { CycleLogRepository } from '../persistence/cycle-log.repository';
import { TokenStore } from '../publisher/linkedin/token.store';
import { Draft } from '../core/draft.entity';
import { RawSignal } from '../core/signal.entity';

const NOW = new Date('2026-08-04T08:00:00Z');

const signal: RawSignal = {
  id: 's1',
  source: 'git',
  kind: 'commit',
  payload: 'feat: backoff',
  refs: [],
  capturedAt: NOW,
  hash: 'h',
};

const draft: Draft = {
  id: 'd1',
  signalId: 's1',
  topic: 'feat: backoff',
  bodyEs: 'texto',
  status: 'PENDING_REVIEW',
  revisions: [],
  scheduledAt: null,
  publishedUrn: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// Note: GeneratorService.generateFor/regenerate return `{ draft, violations }`
// rather than a bare Draft — GeneratorService no longer carries a
// `lastViolations` instance field (that was a race condition on a singleton
// provider). Every generator mock below reflects the real GeneratedDraft
// contract in src/generator/generator.service.ts.
function harness(options: { pending?: RawSignal[]; best?: RawSignal | null } = {}) {
  const reviewed: Draft[] = [];
  const notified: string[] = [];
  const saved: Draft[] = [];
  const logged: string[] = [];
  const marked: string[] = [];

  const curator = {
    collect: async () => options.pending ?? [signal],
    pendingSignals: async () => options.pending ?? [signal],
    pickBest: () => (options.best === undefined ? signal : options.best),
    recentTopics: async () => [],
  } as unknown as CuratorService;

  const generator = {
    generateFor: async () => ({ draft, violations: [] }),
    regenerate: async (d: Draft) => ({
      draft: { ...d, bodyEs: 'reescrito', status: 'PENDING_REVIEW' as const },
      violations: [],
    }),
  } as unknown as GeneratorService;

  const review: ReviewChannelPort = {
    sendForReview: async (d) => {
      reviewed.push(d);
    },
    notify: async (text) => {
      notified.push(text);
    },
    onDecision: () => undefined,
  };

  const drafts = {
    findById: async () => draft,
    save: async (d: Draft) => {
      saved.push(d);
      return d;
    },
    findExpirable: async () => [],
  } as unknown as DraftRepository;

  const signals = {
    markUsed: async (id: string) => {
      marked.push(id);
    },
  } as unknown as SignalRepository;

  const cycles = {
    record: async (_at: Date, outcome: string) => {
      logged.push(outcome);
    },
    lastCycleAt: async () => null,
  } as unknown as CycleLogRepository;

  const tokens = { needsReauth: async () => false } as unknown as TokenStore;

  return {
    reviewed,
    notified,
    saved,
    logged,
    marked,
    service: new CycleService(curator, generator, review, drafts, signals, cycles, tokens),
  };
}

describe('CycleService.runCycle', () => {
  it('generates a draft, sends it for review and marks the signal used', async () => {
    const h = harness();
    const outcome = await h.service.runCycle(NOW);

    expect(outcome).toBe('RAN');
    expect(h.reviewed).toEqual([draft]);
    expect(h.marked).toEqual(['s1']);
    expect(h.logged).toEqual(['RAN']);
  });

  it('skips the cycle and says so when there is no usable material', async () => {
    const h = harness({ best: null });
    const outcome = await h.service.runCycle(NOW);

    expect(outcome).toBe('SKIPPED_NO_MATERIAL');
    expect(h.reviewed).toEqual([]);
    expect(h.notified[0]).toMatch(/sin material/i);
    expect(h.logged).toEqual(['SKIPPED_NO_MATERIAL']);
  });

  it('warns over Telegram when the LinkedIn token needs reauth', async () => {
    const notified: string[] = [];
    const service = new CycleService(
      {
        collect: async () => [signal],
        pendingSignals: async () => [signal],
        pickBest: () => signal,
        recentTopics: async () => [],
      } as unknown as CuratorService,
      { generateFor: async () => ({ draft, violations: [] }) } as unknown as GeneratorService,
      {
        sendForReview: async () => undefined,
        notify: async (text: string) => {
          notified.push(text);
        },
        onDecision: () => undefined,
      } as ReviewChannelPort,
      {
        findById: async () => draft,
        save: async (d: Draft) => d,
        findExpirable: async () => [],
      } as unknown as DraftRepository,
      { markUsed: async () => undefined } as unknown as SignalRepository,
      { record: async () => undefined, lastCycleAt: async () => null } as unknown as CycleLogRepository,
      { needsReauth: async () => true } as unknown as TokenStore,
    );

    await service.runCycle(NOW);
    expect(notified.some((text) => /reconect/i.test(text))).toBe(true);
  });

  it('does not mark the signal used or record RAN when the owner never receives the draft', async () => {
    const marked: string[] = [];
    const logged: string[] = [];
    const service = new CycleService(
      {
        collect: async () => [signal],
        pendingSignals: async () => [signal],
        pickBest: () => signal,
        recentTopics: async () => [],
      } as unknown as CuratorService,
      { generateFor: async () => ({ draft, violations: [] }) } as unknown as GeneratorService,
      {
        sendForReview: async () => {
          throw new Error('Failed to deliver draft d1 to Telegram');
        },
        notify: async () => undefined,
        onDecision: () => undefined,
      } as ReviewChannelPort,
      { findById: async () => draft, save: async (d: Draft) => d, findExpirable: async () => [] } as unknown as DraftRepository,
      { markUsed: async (id: string) => marked.push(id) } as unknown as SignalRepository,
      {
        record: async (_at: Date, outcome: string) => logged.push(outcome),
        lastCycleAt: async () => null,
      } as unknown as CycleLogRepository,
      { needsReauth: async () => false } as unknown as TokenStore,
    );

    const outcome = await service.runCycle(NOW);

    expect(outcome).not.toBe('RAN');
    expect(marked).toEqual([]);
    expect(logged).not.toContain('RAN');
  });

  it('scores the full unused backlog, not only what this run collected', async () => {
    const olderSignal: RawSignal = { ...signal, id: 's-old', payload: 'idea vieja' };
    const collected: RawSignal[] = [];
    const scored: RawSignal[][] = [];
    const curator = {
      collect: async () => {
        collected.push(signal);
        return [signal];
      },
      pendingSignals: async () => [olderSignal, signal],
      pickBest: (candidates: RawSignal[]) => {
        scored.push(candidates);
        return candidates[0];
      },
      recentTopics: async () => [],
    } as unknown as CuratorService;

    const service = new CycleService(
      curator,
      { generateFor: async () => ({ draft, violations: [] }) } as unknown as GeneratorService,
      { sendForReview: async () => undefined, notify: async () => undefined, onDecision: () => undefined },
      { findById: async () => draft, save: async (d: Draft) => d, findExpirable: async () => [] } as unknown as DraftRepository,
      { markUsed: async () => undefined } as unknown as SignalRepository,
      { record: async () => undefined, lastCycleAt: async () => null } as unknown as CycleLogRepository,
      { needsReauth: async () => false } as unknown as TokenStore,
    );

    await service.runCycle(NOW);
    expect(scored[0]).toEqual([olderSignal, signal]);
  });
});

describe('CycleService.handleDecision', () => {
  it('approve moves the draft to APPROVED', async () => {
    const h = harness();
    await h.service.handleDecision('d1', { kind: 'approve' }, NOW);
    expect(h.saved[0].status).toBe('APPROVED');
  });

  it('revise regenerates and sends the new version for review', async () => {
    const h = harness();
    await h.service.handleDecision('d1', { kind: 'revise', feedback: 'mas corto' }, NOW);
    expect(h.reviewed).toHaveLength(1);
    expect(h.reviewed[0].bodyEs).toBe('reescrito');
  });

  it('tells the owner the real state instead of throwing when the draft can no longer take that decision', async () => {
    const expired: Draft = { ...draft, status: 'EXPIRED' };
    const saved: Draft[] = [];
    const notified: string[] = [];
    const service = new CycleService(
      {} as CuratorService,
      {} as GeneratorService,
      {
        sendForReview: async () => undefined,
        notify: async (text: string) => {
          notified.push(text);
        },
        onDecision: () => undefined,
      },
      {
        findById: async () => expired,
        save: async (d: Draft) => {
          saved.push(d);
          return d;
        },
        findExpirable: async () => [],
      } as unknown as DraftRepository,
      {} as SignalRepository,
      {} as CycleLogRepository,
      {} as TokenStore,
    );

    await expect(
      service.handleDecision('d1', { kind: 'approve' }, NOW),
    ).resolves.toBeUndefined();

    expect(saved).toEqual([]);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatch(/vencido/i);
  });

  it('ignores a decision for an unknown draft instead of throwing', async () => {
    const drafts = { findById: async () => null } as unknown as DraftRepository;
    const service = new CycleService(
      {} as CuratorService,
      {} as GeneratorService,
      { sendForReview: async () => undefined, notify: async () => undefined, onDecision: () => undefined },
      drafts,
      {} as SignalRepository,
      {} as CycleLogRepository,
      {} as TokenStore,
    );
    await expect(service.handleDecision('nope', { kind: 'approve' }, NOW)).resolves.toBeUndefined();
  });
});

describe('CycleService.expireStale', () => {
  it('expires stale pending-review drafts and notifies once', async () => {
    const stale: Draft = { ...draft, id: 'd2', status: 'PENDING_REVIEW' };
    const saved: Draft[] = [];
    const notified: string[] = [];
    const drafts = {
      findExpirable: async () => [stale],
      save: async (d: Draft) => {
        saved.push(d);
        return d;
      },
    } as unknown as DraftRepository;
    const service = new CycleService(
      {} as CuratorService,
      {} as GeneratorService,
      { sendForReview: async () => undefined, notify: async (t: string) => { notified.push(t); }, onDecision: () => undefined },
      drafts,
      {} as SignalRepository,
      {} as CycleLogRepository,
      {} as TokenStore,
    );

    const count = await service.expireStale(NOW);
    expect(count).toBe(1);
    expect(saved[0].status).toBe('EXPIRED');
    expect(notified).toHaveLength(1);
  });

  it('does nothing and does not notify when there is nothing to expire', async () => {
    const notified: string[] = [];
    const drafts = { findExpirable: async () => [], save: async () => draft } as unknown as DraftRepository;
    const service = new CycleService(
      {} as CuratorService,
      {} as GeneratorService,
      { sendForReview: async () => undefined, notify: async (t: string) => { notified.push(t); }, onDecision: () => undefined },
      drafts,
      {} as SignalRepository,
      {} as CycleLogRepository,
      {} as TokenStore,
    );

    const count = await service.expireStale(NOW);
    expect(count).toBe(0);
    expect(notified).toEqual([]);
  });
});
