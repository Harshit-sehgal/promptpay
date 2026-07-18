import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';
import { AuditOutboxCron } from './audit-outbox.cron';

@Global()
@Module({
  providers: [AuditService, AuditOutboxCron],
  exports: [AuditService],
})
export class AuditModule {}
