import { Module } from '@nestjs/common';
import { ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';
import { LedgerModule } from '../ledger/ledger.module';
import { FraudModule } from '../fraud/fraud.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [LedgerModule, FraudModule, AuthModule],
  controllers: [ExtensionController],
  providers: [ExtensionService],
})
export class ExtensionModule {}
