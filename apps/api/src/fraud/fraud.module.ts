import { Module } from '@nestjs/common';
import { FraudService } from './fraud.service';
import { FraudController } from './fraud.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({ imports: [LedgerModule], controllers: [FraudController], providers: [FraudService], exports: [FraudService] })
export class FraudModule {}
