import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app.config.js';
import { validateEnv } from './env.validation.js';

@Global()
@Module({
  providers: [
    {
      provide: AppConfig,

      useFactory: (): AppConfig => new AppConfig(validateEnv(process.env)),
    },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
