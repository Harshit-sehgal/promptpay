import { Request } from 'express';
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CreateFeedbackDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

/**
 * Public feedback ingestion. Intentionally NOT protected by JwtAuthGuard — a
 * logged-out visitor must be able to submit feedback. Rate limiting is applied
 * globally by the `default` throttler (200 req/min) and the brute-force guard.
 */
@ApiTags('Feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private service: FeedbackService) {}

  @ApiOperation({ summary: 'Submit feedback' })
  @Post()
  @HttpCode(HttpStatus.OK)
  async submit(@Body() dto: CreateFeedbackDto, @Req() req: Request) {
    const userId = (req as { user?: { id?: string } }).user?.id ?? null;
    return this.service.submitFeedback(dto, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
      userId,
    });
  }
}
