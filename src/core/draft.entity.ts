export type DraftStatus =
  | 'DRAFTING'
  | 'PENDING_REVIEW'
  | 'REVISING'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'DISCARDED'
  | 'EXPIRED';

export type Decision =
  | { kind: 'approve' }
  | { kind: 'discard' }
  | { kind: 'revise'; feedback: string }
  | { kind: 'schedule'; at: Date };

export interface Revision {
  feedback: string;
  body: string;
  at: Date;
}

export interface Draft {
  id: string;
  signalId: string;
  topic: string;
  bodyEs: string;
  status: DraftStatus;
  revisions: Revision[];
  scheduledAt: Date | null;
  publishedUrn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const MAX_REVISIONS = 3;
export const REVIEW_EXPIRY_HOURS = 48;

const ALLOWED: Record<DraftStatus, readonly DraftStatus[]> = {
  DRAFTING: ['PENDING_REVIEW', 'DISCARDED'],
  PENDING_REVIEW: ['APPROVED', 'SCHEDULED', 'REVISING', 'DISCARDED', 'EXPIRED'],
  REVISING: ['PENDING_REVIEW', 'DISCARDED'],
  APPROVED: ['PUBLISHED', 'DISCARDED'],
  SCHEDULED: ['PUBLISHED', 'DISCARDED'],
  PUBLISHED: [],
  DISCARDED: [],
  EXPIRED: [],
};

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  return ALLOWED[from].includes(to);
}

function transition(draft: Draft, to: DraftStatus, now: Date, patch: Partial<Draft> = {}): Draft {
  if (!canTransition(draft.status, to)) {
    throw new Error(`Invalid transition: ${draft.status} -> ${to}`);
  }
  return { ...draft, ...patch, status: to, updatedAt: now };
}

export function applyDecision(draft: Draft, decision: Decision, now: Date): Draft {
  switch (decision.kind) {
    case 'approve':
      return transition(draft, 'APPROVED', now, { scheduledAt: null });
    case 'schedule':
      return transition(draft, 'SCHEDULED', now, { scheduledAt: decision.at });
    case 'discard':
      return transition(draft, 'DISCARDED', now);
    case 'revise': {
      if (draft.revisions.length >= MAX_REVISIONS) {
        throw new Error(`Max revisions reached (${MAX_REVISIONS})`);
      }
      return transition(draft, 'REVISING', now, {
        revisions: [...draft.revisions, { feedback: decision.feedback, body: draft.bodyEs, at: now }],
      });
    }
  }
}
