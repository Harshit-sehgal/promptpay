import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AgentService } from './agent.service';
import { AgentAnalyticsQueryDto, AgentEventsBatchDto } from './dto';

@ApiTags('Agent lifecycle')
@Controller('agent-events')
@UseGuards(JwtAuthGuard, RolesGuard, RejectApiKeyGuard)
@Roles('developer')
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @ApiOperation({ summary: 'Get privacy-safe non-financial agent analytics' })
  @Get('analytics')
  analytics(@CurrentUser('id') userId: string, @Query() query: AgentAnalyticsQueryDto) {
    return this.service.getAnalytics(userId, query);
  }

  @ApiOperation({ summary: 'Ingest sanitized, non-financial agent lifecycle events' })
  @Post('batch')
  // Resolved path: POST /api/v1/agent-events/batch. This endpoint records
  // telemetry only; it never enters ad selection or any ledger path.
  @HttpCode(HttpStatus.OK)
  ingestBatch(
    @CurrentUser('id') userId: string,
    @Body() dto: AgentEventsBatchDto,
    @Headers('x-waitlayer-agent-protocol-version') protocolVersion?: string,
  ) {
    return this.service.ingestBatch(userId, dto, protocolVersion);
  }
}
