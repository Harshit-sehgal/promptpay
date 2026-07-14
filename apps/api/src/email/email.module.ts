import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EmailService } from './email.service';
import { EmailQueueCron } from './email-queue.cron';
import { EmailQueueService } from './email-queue.service';

@Module({
  imports: [ConfigModule],
  providers: [EmailService, EmailQueueService, EmailQueueCron],
  exports: [EmailService, EmailQueueService],
})
export class EmailModule {}
