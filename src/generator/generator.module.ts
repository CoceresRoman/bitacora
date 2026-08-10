import { Module } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LlmModule } from '../llm/llm.module';
import { GeneratorService, VOICE_PROFILE } from './generator.service';

@Module({
  imports: [LlmModule],
  providers: [
    {
      provide: VOICE_PROFILE,
      useFactory: () => readFileSync(join(__dirname, 'voice-profile.md'), 'utf8'),
    },
    GeneratorService,
  ],
  exports: [GeneratorService],
})
export class GeneratorModule {}
