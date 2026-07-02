import { Module } from '@nestjs/common';
import { DeveloperController } from './developer.controller';
import { DeveloperService } from './developer.service';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { FraudModule } from '../fraud/fraud.module';

@Module({
  imports: [FraudModule],
  controllers: [DeveloperController, ApiKeyController],
  providers: [DeveloperService, ApiKeyService],
  exports: [ApiKeyService],
})
export class DeveloperModule {}
