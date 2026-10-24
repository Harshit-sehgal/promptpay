import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { PersonSubject } from '@ateva/db';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { NOTE_MAX_LENGTH, TAG_MAX_PER_PERSON, TAG_PATTERN } from './dto/people.dto';

/**
 * Admin CRM notes and tags on registered users and waitlist entries.
 * Contract: docs/superpowers/specs/2026-10-25-people-crm-design.md
 * ("Revision 2026-10-25").
 *
 * `subjectId` is polymorphic (User.id or AdvertiserWaitlist.id), so there is
 * no foreign key: every erasure path deletes a subject's notes and tags in its
 * own transaction. Audit rows never carry the note body.
 */

const NOTES_CAP = 100;
const TAG_LIST_CAP = 200;

/** Same `targetType` the rest of the People CRM uses for each subject. */
const AUDIT_TARGET_TYPE: Record<PersonSubject, string> = {
  user: 'user',
  waitlist: 'advertiser_waitlist',
};

const NOTE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, email: true } },
} as const;

@Injectable()
export class PeopleNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listNotes(subject: PersonSubject, id: string) {
    await this.assertSubjectExists(subject, id);
    const notes = await this.prisma.personNote.findMany({
      where: { subjectType: subject, subjectId: id },
      select: NOTE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: NOTES_CAP,
    });
    return notes.map(toNoteRow);
  }

  async addNote(
    actorId: string,
    actorRole: string,
    subject: PersonSubject,
    id: string,
    raw: string,
  ) {
    const body = typeof raw === 'string' ? raw.trim() : '';
    if (body.length < 1 || body.length > NOTE_MAX_LENGTH) {
      throw new BadRequestException(`Note must be 1 to ${NOTE_MAX_LENGTH} characters`);
    }
    await this.assertSubjectExists(subject, id);
    const note = await this.prisma.personNote.create({
      data: { subjectType: subject, subjectId: id, authorId: actorId, body },
      select: NOTE_SELECT,
    });
    await this.audit.log({
      actorId,
      actorRole,
      action: 'admin_added_person_note',
      targetType: AUDIT_TARGET_TYPE[subject],
      targetId: id,
      // Never the body: notes can hold personal data.
      afterSnap: { subjectType: subject, noteId: note.id },
    });
    return toNoteRow(note);
  }

  async deleteNote(actorId: string, actorRole: string, noteId: string) {
    const note = await this.prisma.personNote.findUnique({
      where: { id: noteId },
      select: { id: true, subjectType: true, subjectId: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    const { count } = await this.prisma.personNote.deleteMany({ where: { id: noteId } });
    // Another admin deleted it between the read and the write: nothing to audit.
    if (count === 0) throw new NotFoundException('Note not found');
    await this.audit.log({
      actorId,
      actorRole,
      action: 'admin_deleted_person_note',
      targetType: AUDIT_TARGET_TYPE[note.subjectType],
      targetId: note.subjectId,
      beforeSnap: { subjectType: note.subjectType, noteId },
    });
    return { deleted: true as const };
  }

  async setTags(
    actorId: string,
    actorRole: string,
    subject: PersonSubject,
    id: string,
    input: readonly string[],
  ) {
    const next = normalizeTags(input);
    await this.assertSubjectExists(subject, id);

    const before = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent replacements for one person so the 10-tag limit
      // cannot be exceeded by two interleaved delete+insert sequences.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`person-tags:${subject}:${id}`}))`;
      const existing = await tx.personTag.findMany({
        where: { subjectType: subject, subjectId: id },
        select: { tag: true },
      });
      await tx.personTag.deleteMany({
        where: { subjectType: subject, subjectId: id, tag: { notIn: next } },
      });
      if (next.length > 0) {
        await tx.personTag.createMany({
          data: next.map((tag) => ({ subjectType: subject, subjectId: id, tag })),
          skipDuplicates: true,
        });
      }
      return existing.map((r) => r.tag).sort(compareText);
    });

    if (before.length !== next.length || before.some((t, i) => t !== next[i])) {
      await this.audit.log({
        actorId,
        actorRole,
        action: 'admin_set_person_tags',
        targetType: AUDIT_TARGET_TYPE[subject],
        targetId: id,
        beforeSnap: { subjectType: subject, tags: before },
        afterSnap: { subjectType: subject, tags: next },
      });
    }
    return { tags: next };
  }

  /** Tags in use for one subject type, most used first. */
  async listTags(subject: PersonSubject) {
    const groups = await this.prisma.personTag.groupBy({
      by: ['tag'],
      where: { subjectType: subject },
      _count: { _all: true },
      orderBy: [{ _count: { tag: 'desc' } }, { tag: 'asc' }],
      take: TAG_LIST_CAP,
    });
    return groups.map((g) => ({ tag: g.tag, count: g._count._all }));
  }

  private async assertSubjectExists(subject: PersonSubject, id: string): Promise<void> {
    const found =
      subject === 'user'
        ? await this.prisma.user.findUnique({ where: { id }, select: { id: true } })
        : await this.prisma.advertiserWaitlist.findUnique({ where: { id }, select: { id: true } });
    if (!found) {
      throw new NotFoundException(
        subject === 'user' ? 'User not found' : 'Waitlist entry not found',
      );
    }
  }
}

/** Lowercase, trim, validate, collapse duplicates, sort. 400 on any bad tag. */
export function normalizeTags(input: readonly string[]): string[] {
  if (!Array.isArray(input)) throw new BadRequestException('tags must be an array of strings');
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') throw new BadRequestException('tags must be an array of strings');
    const tag = raw.trim().toLowerCase();
    if (!TAG_PATTERN.test(tag)) {
      throw new BadRequestException(
        'Tags use lowercase letters, digits and hyphens, start with a letter or digit, and are at most 32 characters',
      );
    }
    out.add(tag);
  }
  if (out.size > TAG_MAX_PER_PERSON) {
    throw new BadRequestException(`At most ${TAG_MAX_PER_PERSON} tags per person`);
  }
  return [...out].sort(compareText);
}

/** Code-point order, so API sorting does not depend on the DB collation. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toNoteRow(n: {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; email: string } | null;
}) {
  return {
    id: n.id,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    author: n.author ? { id: n.author.id, email: n.author.email } : null,
  };
}
