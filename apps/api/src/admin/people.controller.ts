import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { PersonSubject } from '@ateva/db';

import { CurrentUser, Roles } from '../common/decorators';
import { AdminMfaStepUpGuard } from '../common/guards/admin-mfa-step-up.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { parsePaginationParam } from '../common/utils/pagination-query';
import { AddPersonNoteDto, SetPersonTagsDto, SetWaitlistStatusDto } from './dto/people.dto';
import { PeopleService } from './people.service';
import { PeopleNotesService } from './people-notes.service';
import { PersonSubjectPipe } from './people-subject.pipe';

/**
 * Admin People CRM: registered users and the advertiser waitlist in one place.
 * Contract: docs/superpowers/specs/2026-10-25-people-crm-design.md.
 */
@ApiTags('Admin')
@Controller('admin/people')
// AdminMfaStepUpGuard only gates writes, matching POST /admin/users/:id/status.
@UseGuards(JwtAuthGuard, RolesGuard, AdminMfaStepUpGuard)
@Roles('admin', 'super_admin')
export class PeopleController {
  constructor(
    private readonly service: PeopleService,
    private readonly notes: PeopleNotesService,
  ) {}

  @ApiOperation({ summary: 'People summary: counts and 30-day signup series' })
  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @ApiOperation({ summary: 'List registered users' })
  @Get('users')
  listUsers(
    @Query('search') search?: unknown,
    @Query('role') role?: unknown,
    @Query('status') status?: unknown,
    @Query('country') country?: unknown,
    @Query('verified') verified?: unknown,
    @Query('from') from?: unknown,
    @Query('to') to?: unknown,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
    @Query('tag') tag?: unknown,
  ) {
    return this.service.listUsers(
      {
        search: one(search, 'search'),
        role: one(role, 'role'),
        status: one(status, 'status'),
        country: one(country, 'country'),
        verified: one(verified, 'verified'),
        from: one(from, 'from'),
        to: one(to, 'to'),
        tag: one(tag, 'tag'),
      },
      pageOpts(page, limit),
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
    @Query('search') search?: unknown,
    @Query('status') status?: unknown,
    @Query('country') country?: unknown,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
    @Query('tag') tag?: unknown,
  ) {
    return this.service.listWaitlist(
      {
        search: one(search, 'search'),
        status: one(status, 'status'),
        country: one(country, 'country'),
        tag: one(tag, 'tag'),
      },
      pageOpts(page, limit),
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
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('export')
  exportPeople(
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Query('kind') kind?: unknown,
    @Query('search') search?: unknown,
    @Query('role') role?: unknown,
    @Query('status') status?: unknown,
    @Query('country') country?: unknown,
    @Query('verified') verified?: unknown,
    @Query('from') from?: unknown,
    @Query('to') to?: unknown,
    @Query('tag') tag?: unknown,
  ) {
    return this.service.exportPeople(actorId, actorRole, one(kind, 'kind') ?? '', {
      search: one(search, 'search'),
      role: one(role, 'role'),
      status: one(status, 'status'),
      country: one(country, 'country'),
      verified: one(verified, 'verified'),
      from: one(from, 'from'),
      to: one(to, 'to'),
      tag: one(tag, 'tag'),
    });
  }

  // ── Notes and tags ─────────────────────────────────────────────────────
  // Literal routes (`tags`, `notes/:noteId`) are declared before the
  // `:subject/:id/...` ones and have a different segment count, so the
  // parameterised routes cannot shadow them.

  @ApiOperation({ summary: 'Tags in use for users or the waitlist, with counts' })
  @Get('tags')
  listTags(@Query('subject') subject?: unknown) {
    return this.notes.listTags(PERSON_SUBJECT_QUERY.transform(one(subject, 'subject')));
  }

  @ApiOperation({ summary: 'Delete a person note' })
  @Delete('notes/:noteId')
  deleteNote(
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    return this.notes.deleteNote(actorId, actorRole, noteId);
  }

  @ApiOperation({ summary: 'Notes on a user or waitlist entry (newest first, max 100)' })
  @Get(':subject/:id/notes')
  listNotes(
    @Param('subject', PersonSubjectPipe) subject: PersonSubject,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notes.listNotes(subject, id);
  }

  @ApiOperation({ summary: 'Add a note to a user or waitlist entry' })
  @Post(':subject/:id/notes')
  addNote(
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Param('subject', PersonSubjectPipe) subject: PersonSubject,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPersonNoteDto,
  ) {
    return this.notes.addNote(actorId, actorRole, subject, id, dto.body);
  }

  @ApiOperation({ summary: 'Replace the tags on a user or waitlist entry' })
  @Put(':subject/:id/tags')
  setTags(
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Param('subject', PersonSubjectPipe) subject: PersonSubject,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPersonTagsDto,
  ) {
    return this.notes.setTags(actorId, actorRole, subject, id, dto.tags);
  }
}

const PERSON_SUBJECT_QUERY = new PersonSubjectPipe();

/**
 * These params are bare query strings, so the global ValidationPipe never
 * sees them. A repeated key (`?search=a&search=b`) arrives as an array and
 * would otherwise reach `.trim()` and fail as a 500.
 */
function one(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be a single value`);
  return value;
}

function pageOpts(page: unknown, limit: unknown) {
  return {
    page: parsePaginationParam(one(page, 'page')),
    limit: parsePaginationParam(one(limit, 'limit')),
  };
}
