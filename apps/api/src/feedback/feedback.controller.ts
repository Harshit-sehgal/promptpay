import { Request } from 'express';
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CreateFeedbackDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

/**
 * Public feedback ingestion. Intentionally NOT protected by JwtAuthGuard — a
 * logged-out visitor must be able to submit feedback. The endpoint-level 5/min
 * throttle (below) is tighter than the global `default` 200 req/min and is the
 * primary rate-limit for this route. The `BruteForceGuard` (global) further
 * catches high-frequency repeat attempts.
 */
@ApiTags('Feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private service: FeedbackService) {}

  @ApiOperation({ summary: 'Submit feedback' })
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async submit(@Body() dto: CreateFeedbackDto, @Req() req: Request) {
    const userId = (req as { user?: { id?: string } }).user?.id ?? null;
    return this.service.submitFeedback(dto, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
      userId,
    });
  }
}
