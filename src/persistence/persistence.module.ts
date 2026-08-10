import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SignalRepository } from './signal.repository';
import { DraftRepository } from './draft.repository';
import { CycleLogRepository } from './cycle-log.repository';

@Global()
@Module({
  providers: [PrismaService, SignalRepository, DraftRepository, CycleLogRepository],
  exports: [PrismaService, SignalRepository, DraftRepository, CycleLogRepository],
})
export class PersistenceModule {}
