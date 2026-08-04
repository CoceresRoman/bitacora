import { BACKOFF_MINUTES, MAX_PUBLISH_ATTEMPTS, PublishQueue } from './publish.queue';
import { PublisherPort } from '../core/ports/publisher.port';
import { ReviewChannelPort } from '../core/ports/review-channel.port';
import { DraftRepository } from '../persistence/draft.repository';
import { Draft } from '../core/draft.entity';

const NOW = new Date('2026-08-04T12:00:00Z');

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    signalId: 's1',
    topic: 't',
    bodyEs: 'texto',
    status: 'APPROVED',
    revisions: [],
    scheduledAt: null,
    publishedUrn: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function harness(due: Draft[], publisher: PublisherPort) {
  const saved: Draft[] = [];
  const notified: string[] = [];
  const attempts = new Map<string, number>();
  const drafts = {
    findDuePublication: async () => due,
    save: async (d: Draft) => {
      saved.push(d);
      return d;
    },
    incrementAttempts: async (id: string) => {
      const next = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, next);
      return next;
    },
  } as unknown as DraftRepository;
  const review = {
    notify: async (text: string) => {
      notified.push(text);
    },
    sendForReview: async () => undefined,
    onDecision: () => undefined,
  } as ReviewChannelPort;
  return { saved, notified, attempts, queue: new PublishQueue(drafts, publisher, review) };
}

describe('PublishQueue.drain', () => {
  it('publishes a due draft and stores the URN', async () => {
    const publisher: PublisherPort = { publish: async () => ({ urn: 'urn:li:share:1' }) };
    const h = harness([draft()], publisher);

    await h.queue.drain(NOW);

    expect(h.saved[0].status).toBe('PUBLISHED');
    expect(h.saved[0].publishedUrn).toBe('urn:li:share:1');
  });

  it('does not republish a draft that already has a URN', async () => {
    let calls = 0;
    const publisher: PublisherPort = {
      publish: async () => {
        calls++;
        return { urn: 'urn:li:share:2' };
      },
    };
    const h = harness([draft({ publishedUrn: 'urn:li:share:existing', status: 'PUBLISHED' })], publisher);

    await h.queue.drain(NOW);

    expect(calls).toBe(0);
    expect(h.saved).toEqual([]);
  });

  it('keeps the draft approved and counts the attempt when publishing fails', async () => {
    const publisher: PublisherPort = {
      publish: async () => {
        throw new Error('LinkedIn returned 429: rate limited');
      },
    };
    const h = harness([draft()], publisher);

    await h.queue.drain(NOW);

    expect(h.attempts.get('d1')).toBe(1);
    expect(h.saved).toEqual([]);
    expect(h.notified).toEqual([]);
  });

  it('notifies over the review channel once the attempts are exhausted', async () => {
    const publisher: PublisherPort = {
      publish: async () => {
        throw new Error('LinkedIn returned 500: boom');
      },
    };
    const h = harness([draft()], publisher);
    h.attempts.set('d1', MAX_PUBLISH_ATTEMPTS - 1);

    await h.queue.drain(NOW);

    expect(h.notified).toHaveLength(1);
    expect(h.notified[0]).toContain('d1');
    expect(h.notified[0]).toContain('500');
  });

  it('publishes the second draft even when the first one fails', async () => {
    const publisher: PublisherPort = {
      publish: async (text) => {
        if (text === 'falla') throw new Error('LinkedIn returned 500: boom');
        return { urn: 'urn:li:share:3' };
      },
    };
    const h = harness([draft({ id: 'd1', bodyEs: 'falla' }), draft({ id: 'd2', bodyEs: 'ok' })], publisher);

    await h.queue.drain(NOW);

    expect(h.saved.map((d) => d.id)).toEqual(['d2']);
  });

  it('uses an increasing backoff', () => {
    expect(BACKOFF_MINUTES).toEqual([1, 5, 25]);
    expect(MAX_PUBLISH_ATTEMPTS).toBe(3);
  });
});
