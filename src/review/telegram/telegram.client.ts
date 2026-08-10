import { Injectable, Logger } from '@nestjs/common';

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  /** Telegram can send these for edited or channel-authored content; we intentionally never act on them. */
  edited_message?: { chat: { id: number }; text?: string };
  channel_post?: { chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);

  constructor(private readonly botToken: string) {}

  private async call<T>(method: string, body: unknown, signal?: AbortSignal): Promise<T | null> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        this.logger.warn(`Telegram ${method} failed with status ${response.status}`);
        return null;
      }
      const payload = (await response.json()) as { ok: boolean; result: T };
      return payload.ok ? payload.result : null;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return null;
      }
      this.logger.warn(`Telegram ${method} unreachable: ${(error as Error).message}`);
      return null;
    }
  }

  async getUpdates(
    offset: number,
    timeoutSec: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    return (
      (await this.call<TelegramUpdate[]>('getUpdates', { offset, timeout: timeoutSec }, signal)) ?? []
    );
  }

  /**
   * Returns whether Telegram confirmed delivery. `call()` swallows network
   * and API errors into `null`, so callers that must know whether the
   * owner actually received the message (e.g. draft review requests)
   * cannot rely on this resolving as evidence of success — they need to
   * check the return value.
   */
  async sendMessage(chatId: string, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
    const result = await this.call('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: keyboard,
      disable_web_page_preview: true,
    });
    return result !== null;
  }

  async answerCallbackQuery(id: string, text: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, text });
  }
}
