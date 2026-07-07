import { Module } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { RetentionCronService } from './retention.cron';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../config/prisma.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, RetentionCronService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
