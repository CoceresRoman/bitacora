import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Decision, Draft } from '../../core/draft.entity';
import { DecisionHandler, ReviewChannelPort } from '../../core/ports/review-channel.port';
import { InboxSource } from '../../sources/inbox/inbox.source';
import { InlineKeyboard, TelegramClient, TelegramUpdate } from './telegram.client';

export interface TelegramConfig {
  botToken: string;
  allowedChatId: string;
}

export const TELEGRAM_CONFIG = Symbol('TelegramConfig');

const POLL_TIMEOUT_SEC = 30;
const SCHEDULE_HOUR = 9;

function nextNineAm(now: Date): Date {
  const next = new Date(now);
  next.setHours(SCHEDULE_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

@Injectable()
export class TelegramAdapter implements ReviewChannelPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramAdapter.name);
  private handler: DecisionHandler | null = null;
  private awaitingFeedbackFor: string | null = null;
  private offset = 0;
  private polling = false;

  constructor(
    private readonly client: TelegramClient,
    private readonly inbox: InboxSource,
    @Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig,
  ) {}

  onModuleInit(): void {
    this.polling = true;
    void this.pollLoop();
  }

  onModuleDestroy(): void {
    this.polling = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      const updates = await this.client.getUpdates(this.offset, POLL_TIMEOUT_SEC);
      for (const update of updates) {
        this.offset = update.update_id + 1;
        try {
          await this.handleUpdate(update, new Date());
        } catch (error) {
          this.logger.error(`Update ${update.update_id} failed: ${(error as Error).message}`);
        }
      }
    }
  }

  onDecision(handler: DecisionHandler): void {
    this.handler = handler;
  }

  async notify(text: string): Promise<void> {
    await this.client.sendMessage(this.config.allowedChatId, text);
  }

  async sendForReview(draft: Draft): Promise<void> {
    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Aprobar', callback_data: `ok:${draft.id}` },
          { text: '✏️ Reescribir', callback_data: `rev:${draft.id}` },
        ],
        [
          { text: '🕘 Programar 09:00', callback_data: `sched:${draft.id}` },
          { text: '🗑 Descartar', callback_data: `del:${draft.id}` },
        ],
      ],
    };
    const footer = `\n\n— tema: ${draft.topic} · ${draft.bodyEs.length} caracteres`;
    await this.client.sendMessage(
      this.config.allowedChatId,
      `${draft.bodyEs}${footer}`,
      keyboard,
    );
  }

  /** Exposed for tests and for the poll loop. Enforces the chat whitelist. */
  async handleUpdate(update: TelegramUpdate, now: Date): Promise<void> {
    const chatId =
      update.callback_query?.message?.chat.id ?? update.message?.chat.id ?? undefined;
    if (chatId === undefined || String(chatId) !== this.config.allowedChatId) {
      this.logger.warn(`Dropping update from unauthorized chat ${String(chatId)}`);
      return;
    }

    if (update.callback_query?.data) {
      await this.handleCallback(update.callback_query.id, update.callback_query.data, now);
      return;
    }

    const text = update.message?.text?.trim();
    if (!text) return;

    if (this.awaitingFeedbackFor) {
      const draftId = this.awaitingFeedbackFor;
      this.awaitingFeedbackFor = null;
      await this.emit(draftId, { kind: 'revise', feedback: text });
      return;
    }

    await this.inbox.capture(text, now);
    await this.notify('Idea guardada. Entra al próximo ciclo.');
  }

  private async handleCallback(callbackId: string, data: string, now: Date): Promise<void> {
    const [action, draftId] = data.split(':');
    switch (action) {
      case 'ok':
        await this.client.answerCallbackQuery(callbackId, 'Aprobado');
        await this.emit(draftId, { kind: 'approve' });
        return;
      case 'del':
        await this.client.answerCallbackQuery(callbackId, 'Descartado');
        await this.emit(draftId, { kind: 'discard' });
        return;
      case 'sched':
        await this.client.answerCallbackQuery(callbackId, 'Programado 09:00');
        await this.emit(draftId, { kind: 'schedule', at: nextNineAm(now) });
        return;
      case 'rev':
        this.awaitingFeedbackFor = draftId;
        await this.client.answerCallbackQuery(callbackId, 'Mandá el cambio');
        await this.notify('¿Qué cambio? Respondé con el texto.');
        return;
      default:
        this.logger.warn(`Unknown callback action: ${action}`);
    }
  }

  private async emit(draftId: string, decision: Decision): Promise<void> {
    if (!this.handler) {
      this.logger.error('Decision received before a handler was registered');
      return;
    }
    await this.handler(draftId, decision);
  }
}
