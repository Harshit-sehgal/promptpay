import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FraudModule } from '../fraud/fraud.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';

@Module({
  imports: [LedgerModule, FraudModule, AuthModule],
  controllers: [ExtensionController],
  providers: [ExtensionService],
})
export class ExtensionModule {}
