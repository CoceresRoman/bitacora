import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PUBLISHER_PORT } from '../core/ports/publisher.port';
import type { Env } from '../config/env.schema';
import { TelegramModule } from '../review/telegram/telegram.module';
import { TokenStore, ENCRYPTION_KEY } from './linkedin/token.store';
import { LinkedInPublisher, LINKEDIN_API_VERSION } from './linkedin/linkedin.publisher';
import { LinkedInOAuthController } from './linkedin/linkedin.oauth.controller';
import { PublishQueue } from './publish.queue';

@Module({
  imports: [TelegramModule],
  controllers: [LinkedInOAuthController],
  providers: [
    {
      provide: ENCRYPTION_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('ENCRYPTION_KEY', { infer: true }),
    },
    {
      provide: LINKEDIN_API_VERSION,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('LINKEDIN_API_VERSION', { infer: true }),
    },
    TokenStore,
    LinkedInPublisher,
    { provide: PUBLISHER_PORT, useExisting: LinkedInPublisher },
    PublishQueue,
  ],
  exports: [PUBLISHER_PORT, PublishQueue, TokenStore],
})
export class PublisherModule {}
