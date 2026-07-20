import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../config/prisma.module';
import { RuntimeConfigService } from './runtime-config.service';

@Module({
  imports: [PrismaModule, AuditModule, ConfigModule],
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
