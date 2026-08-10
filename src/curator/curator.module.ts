import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module';
import { CuratorService } from './curator.service';

@Module({
  imports: [SourcesModule],
  providers: [CuratorService],
  exports: [CuratorService],
})
export class CuratorModule {}
