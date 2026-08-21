import { Request } from 'express';
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CreateWaitlistDto } from './dto/waitlist.dto';
import { WaitlistService } from './waitlist.service';

/**
 * Public advertiser-waitlist ingestion. Intentionally NOT protected by
 * JwtAuthGuard — a logged-out marketer must be able to join. The endpoint-level
 * 5/min throttle (below) is tighter than the global `default` 200 req/min and
 * is the primary rate-limit for this route; the global BruteForceGuard further
 * catches high-frequency repeat attempts.
 */
@ApiTags('Waitlist')
@Controller('marketing/waitlist')
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}

  @ApiOperation({ summary: 'Join the advertiser waitlist' })
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async submit(@Body() dto: CreateWaitlistDto, @Req() req: Request) {
    return this.service.submit(dto, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }
}
