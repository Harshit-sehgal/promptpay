import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { FraudModule } from '../fraud/fraud.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';

@Module({
  imports: [LedgerModule, FraudModule, AuthModule, ComplianceModule],
  controllers: [ExtensionController],
  providers: [ExtensionService],
})
export class ExtensionModule {}
