import { Module } from '@nestjs/common';
import { DeveloperController } from './developer.controller';
import { DeveloperService } from './developer.service';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { FraudModule } from '../fraud/fraud.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [FraudModule, AuthModule, EmailModule],
  controllers: [DeveloperController, ApiKeyController],
  providers: [DeveloperService, ApiKeyService],
  exports: [ApiKeyService, DeveloperService],
})
export class DeveloperModule {}
