import { Module } from '@nestjs/common';

import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { LedgerCronService } from './ledger-cron.service';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService, LedgerCronService],
  exports: [LedgerService],
})
export class LedgerModule {}
