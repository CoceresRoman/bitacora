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

// PublisherModule deliberately does not import TelegramModule yet (see its
// own comment), so this module imports both directly to satisfy
// REVIEW_CHANNEL_PORT for CycleService and PublishQueue alike.
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
