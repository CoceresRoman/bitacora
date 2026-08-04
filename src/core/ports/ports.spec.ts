import { LLM_PORT, LlmPort } from './llm.port';
import { PUBLISHER_PORT, PublisherPort } from './publisher.port';
import { REVIEW_CHANNEL_PORT, ReviewChannelPort } from './review-channel.port';
import { SOURCE_PORTS, SourcePort } from './source.port';
import { Decision, Draft } from '../draft.entity';

describe('port tokens', () => {
  it('are unique symbols', () => {
    const tokens = [LLM_PORT, PUBLISHER_PORT, REVIEW_CHANNEL_PORT, SOURCE_PORTS];
    expect(new Set(tokens).size).toBe(tokens.length);
    tokens.forEach((token) => expect(typeof token).toBe('symbol'));
  });
});

describe('port contracts', () => {
  it('are satisfiable by in-memory fakes', async () => {
    const llm: LlmPort = { generate: async () => 'texto' };
    const publisher: PublisherPort = { publish: async () => ({ urn: 'urn:li:share:1' }) };
    const decisions: Array<(id: string, d: Decision) => Promise<void>> = [];
    const review: ReviewChannelPort = {
      sendForReview: async (_draft: Draft) => undefined,
      notify: async () => undefined,
      onDecision: (handler) => decisions.push(handler),
    };
    const source: SourcePort = { source: 'git', collect: async () => [] };

    expect(await llm.generate('p')).toBe('texto');
    expect((await publisher.publish('t')).urn).toBe('urn:li:share:1');
    review.onDecision(async () => undefined);
    expect(decisions).toHaveLength(1);
    expect(await source.collect(new Date())).toEqual([]);
  });
});
