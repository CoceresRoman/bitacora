import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PUBLISHER_PORT } from '../core/ports/publisher.port';
import type { Env } from '../config/env.schema';
import { TokenStore, ENCRYPTION_KEY } from './linkedin/token.store';
import { LinkedInPublisher, LINKEDIN_API_VERSION } from './linkedin/linkedin.publisher';
import { LinkedInOAuthController } from './linkedin/linkedin.oauth.controller';
import { PublishQueue } from './publish.queue';

// TelegramModule (Task 10) is not merged yet, so it is intentionally not
// imported here. REVIEW_CHANNEL_PORT is provided at integration time when
// the review module is wired alongside this one; PublishQueue's unit tests
// inject a fake ReviewChannelPort directly and do not depend on it.
@Module({
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
