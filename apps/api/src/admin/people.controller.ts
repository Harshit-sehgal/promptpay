import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { parsePaginationParam } from '../common/utils/pagination-query';
import { SetWaitlistStatusDto } from './dto/people.dto';
import { PeopleService } from './people.service';

/**
 * Admin People CRM: registered users and the advertiser waitlist in one place.
 * Contract: docs/superpowers/specs/2026-10-25-people-crm-design.md.
 */
@ApiTags('Admin')
@Controller('admin/people')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class PeopleController {
  constructor(private readonly service: PeopleService) {}

  @ApiOperation({ summary: 'People summary: counts and 30-day signup series' })
  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @ApiOperation({ summary: 'List registered users' })
  @Get('users')
  listUsers(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('country') country?: string,
    @Query('verified') verified?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listUsers(
      { search, role, status, country, verified, from, to },
      { page: parsePaginationParam(page), limit: parsePaginationParam(limit) },
    );
  }

  @ApiOperation({ summary: 'Registered user detail' })
  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getUser(id);
  }

  @ApiOperation({ summary: 'List advertiser waitlist entries' })
  @Get('waitlist')
  listWaitlist(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('country') country?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listWaitlist(
      { search, status, country },
      { page: parsePaginationParam(page), limit: parsePaginationParam(limit) },
    );
  }

  @ApiOperation({ summary: 'Set an advertiser waitlist entry status' })
  @Post('waitlist/:id/status')
  setWaitlistStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Body() dto: SetWaitlistStatusDto,
  ) {
    return this.service.setWaitlistStatus(actorId, actorRole, id, dto.status);
  }

  @ApiOperation({ summary: 'Export people (JSON, capped at 10 000 rows)' })
  @Get('export')
  exportPeople(
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Query('kind') kind?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('country') country?: string,
    @Query('verified') verified?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.exportPeople(actorId, actorRole, kind ?? '', {
      search,
      role,
      status,
      country,
      verified,
      from,
      to,
    });
  }
}
