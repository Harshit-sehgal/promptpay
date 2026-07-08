import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../config/prisma.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { RetentionCronService } from './retention.cron';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, RetentionCronService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
