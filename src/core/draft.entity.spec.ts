import { applyDecision, canTransition, Draft, MAX_REVISIONS } from './draft.entity';

const NOW = new Date('2026-08-04T12:00:00Z');

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'd1',
    signalId: 's1',
    topic: 'retry backoff',
    bodyEs: 'texto original',
    status: 'PENDING_REVIEW',
    revisions: [],
    scheduledAt: null,
    publishedUrn: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('canTransition', () => {
  it('allows PENDING_REVIEW -> APPROVED', () => {
    expect(canTransition('PENDING_REVIEW', 'APPROVED')).toBe(true);
  });

  it('forbids PUBLISHED -> anything', () => {
    expect(canTransition('PUBLISHED', 'APPROVED')).toBe(false);
    expect(canTransition('PUBLISHED', 'DISCARDED')).toBe(false);
  });

  it('forbids skipping review', () => {
    expect(canTransition('DRAFTING', 'PUBLISHED')).toBe(false);
  });
});

describe('applyDecision', () => {
  it('does not mutate the input draft', () => {
    const original = draft();
    applyDecision(original, { kind: 'approve' }, NOW);
    expect(original.status).toBe('PENDING_REVIEW');
  });

  it('approve moves to APPROVED with no scheduled date', () => {
    const result = applyDecision(draft(), { kind: 'approve' }, NOW);
    expect(result.status).toBe('APPROVED');
    expect(result.scheduledAt).toBeNull();
  });

  it('schedule moves to SCHEDULED and stores the date', () => {
    const at = new Date('2026-08-05T09:00:00Z');
    const result = applyDecision(draft(), { kind: 'schedule', at }, NOW);
    expect(result.status).toBe('SCHEDULED');
    expect(result.scheduledAt).toEqual(at);
  });

  it('revise moves to REVISING and records the feedback with the current body', () => {
    const result = applyDecision(draft(), { kind: 'revise', feedback: 'mas corto' }, NOW);
    expect(result.status).toBe('REVISING');
    expect(result.revisions).toEqual([{ feedback: 'mas corto', body: 'texto original', at: NOW }]);
  });

  it('rejects a revision past MAX_REVISIONS', () => {
    const exhausted = draft({
      revisions: Array.from({ length: MAX_REVISIONS }, () => ({
        feedback: 'x',
        body: 'y',
        at: NOW,
      })),
    });
    expect(() => applyDecision(exhausted, { kind: 'revise', feedback: 'otra' }, NOW)).toThrow(
      /max revisions/i,
    );
  });

  it('rejects a decision on a published draft', () => {
    const published = draft({ status: 'PUBLISHED', publishedUrn: 'urn:li:share:1' });
    expect(() => applyDecision(published, { kind: 'approve' }, NOW)).toThrow(/invalid transition/i);
  });
});
