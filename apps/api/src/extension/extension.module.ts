import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { FraudModule } from '../fraud/fraud.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';
import { WaitAttestationService } from './wait-attestation.service';
import { WaitAttestationCleanupCron } from './wait-attestation-cleanup.cron';

@Module({
  imports: [LedgerModule, FraudModule, AuthModule, ComplianceModule, RuntimeConfigModule],
  controllers: [ExtensionController],
  providers: [ExtensionService, WaitAttestationService, WaitAttestationCleanupCron],
})
export class ExtensionModule {}
