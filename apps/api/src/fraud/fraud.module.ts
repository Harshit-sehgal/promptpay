import { Module } from '@nestjs/common';

import { LedgerModule } from '../ledger/ledger.module';
import { FraudController } from './fraud.controller';
import { FraudService } from './fraud.service';

@Module({ imports: [LedgerModule], controllers: [FraudController], providers: [FraudService], exports: [FraudService] })
export class FraudModule {}
