import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { REVIEW_CHANNEL_PORT, ReviewChannelPort } from '../core/ports/review-channel.port';
import { CuratorModule } from '../curator/curator.module';
import { GeneratorModule } from '../generator/generator.module';
import { TelegramModule } from '../review/telegram/telegram.module';
import { PublisherModule } from '../publisher/publisher.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { CycleService } from './cycle.service';
import { SchedulerService } from './scheduler.service';

// PublisherModule imports TelegramModule itself (to satisfy PublishQueue's
// REVIEW_CHANNEL_PORT dependency), but that import is private to
// PublisherModule's own injector scope and is not re-exported. CycleService
// is a provider of this module, so it needs its own visibility into
// REVIEW_CHANNEL_PORT — hence importing TelegramModule directly here too.
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PersistenceModule,
    CuratorModule,
    GeneratorModule,
    TelegramModule,
    PublisherModule,
  ],
  providers: [CycleService, SchedulerService],
  exports: [CycleService],
})
export class SchedulerModule implements OnModuleInit {
  constructor(
    private readonly cycle: CycleService,
    @Inject(REVIEW_CHANNEL_PORT) private readonly review: ReviewChannelPort,
  ) {}

  /** Wires the review channel's decisions into the cycle. */
  onModuleInit(): void {
    this.review.onDecision(async (draftId, decision) => {
      await this.cycle.handleDecision(draftId, decision, new Date());
    });
  }
}
