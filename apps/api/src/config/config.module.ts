import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app.config';
import { validateEnv } from './env.validation';

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
