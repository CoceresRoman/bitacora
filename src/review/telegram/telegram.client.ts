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

  private async call<T>(method: string, body: unknown): Promise<T | null> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        this.logger.warn(`Telegram ${method} failed with status ${response.status}`);
        return null;
      }
      const payload = (await response.json()) as { ok: boolean; result: T };
      return payload.ok ? payload.result : null;
    } catch (error) {
      this.logger.warn(`Telegram ${method} unreachable: ${(error as Error).message}`);
      return null;
    }
  }

  async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    return (await this.call<TelegramUpdate[]>('getUpdates', { offset, timeout: timeoutSec })) ?? [];
  }

  async sendMessage(chatId: string, text: string, keyboard?: InlineKeyboard): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: keyboard,
      disable_web_page_preview: true,
    });
  }

  async answerCallbackQuery(id: string, text: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, text });
  }
}
