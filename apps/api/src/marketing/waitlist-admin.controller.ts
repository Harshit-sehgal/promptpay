import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { parsePaginationParam } from '../common/utils/pagination-query';
import { WaitlistQueryDto } from './dto/waitlist.dto';
import { WaitlistService } from './waitlist.service';

/**
 * Admin surface for the advertiser waitlist. Read-only by design: status
 * transitions (`pending → invited/onboarded/declined`) are an operator
 * decision made in the database or a future admin tool, and this listing
 * deliberately omits `ipHash` — the pseudonym exists for spam triage at write
 * time, not for display.
 */
@ApiTags('Admin')
@Controller('admin/waitlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class WaitlistAdminController {
  constructor(private readonly service: WaitlistService) {}

  @ApiOperation({ summary: 'List advertiser waitlist signups' })
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listForAdmin({
      status: status as WaitlistQueryDto['status'],
      page: parsePaginationParam(page),
      limit: parsePaginationParam(limit),
    });
  }
}
