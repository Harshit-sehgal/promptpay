import { Module } from '@nestjs/common';
import { ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';
import { LedgerModule } from '../ledger/ledger.module';
import { FraudModule } from '../fraud/fraud.module';

@Module({
  imports: [LedgerModule, FraudModule],
  controllers: [ExtensionController],
  providers: [ExtensionService],
})
export class ExtensionModule {}
