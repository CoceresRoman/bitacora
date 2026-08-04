import { Decision, Draft } from '../draft.entity';

export type DecisionHandler = (draftId: string, decision: Decision) => Promise<void>;

export interface ReviewChannelPort {
  sendForReview(draft: Draft): Promise<void>;
  notify(text: string): Promise<void>;
  onDecision(handler: DecisionHandler): void;
}

export const REVIEW_CHANNEL_PORT = Symbol('ReviewChannelPort');
