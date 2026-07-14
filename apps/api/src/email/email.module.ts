import { Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { EmailQueueCron } from './email-queue.cron';
import { EmailQueueService } from './email-queue.service';

@Module({
  providers: [EmailService, EmailQueueService, EmailQueueCron],
  exports: [EmailService, EmailQueueService],
})
export class EmailModule {}
