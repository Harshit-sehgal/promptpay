import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../config/prisma.module';
import { RuntimeConfigService } from './runtime-config.service';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
