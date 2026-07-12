import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../config/prisma.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ConsentAnonymousController } from './consent-anonymous.controller';
import { ConsentVersionsController } from './consent-versions.controller';
import { RetentionCronService } from './retention.cron';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ConsentVersionsController, ConsentAnonymousController, ComplianceController],
  providers: [ComplianceService, RetentionCronService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
