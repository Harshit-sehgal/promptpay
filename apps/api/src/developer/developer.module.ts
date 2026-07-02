import { Module } from '@nestjs/common';
import { DeveloperController } from './developer.controller';
import { DeveloperService } from './developer.service';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';

@Module({
  controllers: [DeveloperController, ApiKeyController],
  providers: [DeveloperService, ApiKeyService],
  exports: [ApiKeyService],
})
export class DeveloperModule {}
