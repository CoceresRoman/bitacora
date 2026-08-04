import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REVIEW_CHANNEL_PORT } from '../../core/ports/review-channel.port';
import type { Env } from '../../config/env.schema';
import { SourcesModule } from '../../sources/sources.module';
import { TelegramClient } from './telegram.client';
import { TelegramAdapter, TELEGRAM_CONFIG } from './telegram.adapter';

@Module({
  imports: [SourcesModule],
  providers: [
    {
      provide: TelegramClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new TelegramClient(config.get('TELEGRAM_BOT_TOKEN', { infer: true })),
    },
    {
      provide: TELEGRAM_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        botToken: config.get('TELEGRAM_BOT_TOKEN', { infer: true }),
        allowedChatId: config.get('TELEGRAM_ALLOWED_CHAT_ID', { infer: true }),
      }),
    },
    TelegramAdapter,
    { provide: REVIEW_CHANNEL_PORT, useExisting: TelegramAdapter },
  ],
  exports: [REVIEW_CHANNEL_PORT, TelegramAdapter],
})
export class TelegramModule {}
