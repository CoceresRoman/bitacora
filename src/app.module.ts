import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.schema';
import { PersistenceModule } from './persistence/persistence.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchema.parse(raw),
    }),
    PersistenceModule,
  ],
})
export class AppModule {}
