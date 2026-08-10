import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.schema';
import { SchedulerModule } from './scheduler/scheduler.module';

// SchedulerModule already imports everything the app needs at runtime
// (PersistenceModule, CuratorModule -> SourcesModule, GeneratorModule ->
// LlmModule, TelegramModule, PublisherModule) plus ScheduleModule.forRoot()
// for cron. Importing it here alone wires the full dependency graph;
// importing the feature modules again directly would just duplicate what
// SchedulerModule already declares.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchema.parse(raw),
    }),
    SchedulerModule,
  ],
})
export class AppModule {}
