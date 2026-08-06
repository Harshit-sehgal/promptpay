import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';

@Module({
  imports: [AuditModule],
  controllers: [SandboxController],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
