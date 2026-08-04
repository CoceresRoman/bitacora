import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export type CycleOutcome = 'RAN' | 'SKIPPED_NO_MATERIAL' | 'SKIPPED_STALE';

@Injectable()
export class CycleLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lastCycleAt(): Promise<Date | null> {
    const row = await this.prisma.cycleLog.findFirst({ orderBy: { at: 'desc' } });
    return row?.at ?? null;
  }

  async record(at: Date, outcome: CycleOutcome): Promise<void> {
    await this.prisma.cycleLog.create({ data: { at, outcome } });
  }
}
