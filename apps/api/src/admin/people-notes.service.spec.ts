import { vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { normalizeTags, PeopleNotesService } from './people-notes.service';

function makeService() {
  const personNote = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const personTag = {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    groupBy: vi.fn().mockResolvedValue([]),
  };
  const user = { findUnique: vi.fn().mockResolvedValue({ id: 'u1' }) };
  const advertiserWaitlist = { findUnique: vi.fn().mockResolvedValue({ id: 'wl-1' }) };
  const tx = { $executeRaw: vi.fn().mockResolvedValue(1), personTag };
  const prisma = {
    personNote,
    personTag,
    user,
    advertiserWaitlist,
    $transaction: vi.fn((fn: (c: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const auditLog = vi.fn().mockResolvedValue(undefined);
  const audit = { log: auditLog } as unknown as AuditService;
  return {
    service: new PeopleNotesService(prisma, audit),
    personNote,
    personTag,
    user,
    advertiserWaitlist,
    tx,
    prisma,
    auditLog,
  };
}

const NOTE = {
  id: 'n1',
  body: 'Met at a conference',
  createdAt: new Date('2026-10-20T10:00:00Z'),
  author: { id: 'admin-1', email: 'admin@example.com' },
};

describe('PeopleNotesService notes', () => {
  it('lists newest first, capped at 100, with author and ISO dates', async () => {
    const { service, personNote } = makeService();
    personNote.findMany.mockResolvedValue([NOTE, { ...NOTE, id: 'n0', author: null }]);
    const rows = await service.listNotes('user', 'u1');
    expect(personNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectType: 'user', subjectId: 'u1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    );
    expect(rows).toEqual([
      {
        id: 'n1',
        body: 'Met at a conference',
        createdAt: '2026-10-20T10:00:00.000Z',
        author: { id: 'admin-1', email: 'admin@example.com' },
      },
      expect.objectContaining({ id: 'n0', author: null }),
    ]);
  });

  it('404s for a missing user or waitlist entry on every note and tag route', async () => {
    const m = makeService();
    m.user.findUnique.mockResolvedValue(null);
    m.advertiserWaitlist.findUnique.mockResolvedValue(null);
    await expect(m.service.listNotes('user', 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.service.addNote('a', 'admin', 'waitlist', 'x', 'hi')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(m.service.setTags('a', 'admin', 'user', 'x', ['vip'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(m.personNote.create).not.toHaveBeenCalled();
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
    expect(m.auditLog).not.toHaveBeenCalled();
  });

  it('adds a trimmed note by the actor and audits without the body', async () => {
    const { service, personNote, auditLog } = makeService();
    personNote.create.mockResolvedValue(NOTE);
    const row = await service.addNote('admin-1', 'admin', 'user', 'u1', '  Secret detail  ');
    expect(personNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          subjectType: 'user',
          subjectId: 'u1',
          authorId: 'admin-1',
          body: 'Secret detail',
        },
      }),
    );
    expect(row.id).toBe('n1');
    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      actorId: 'admin-1',
      actorRole: 'admin',
      action: 'admin_added_person_note',
      targetType: 'user',
      targetId: 'u1',
      afterSnap: { subjectType: 'user', noteId: 'n1' },
    });
    expect(JSON.stringify(entry)).not.toContain('Secret detail');
  });

  it('audits waitlist notes under the advertiser_waitlist target type', async () => {
    const { service, personNote, auditLog } = makeService();
    personNote.create.mockResolvedValue(NOTE);
    await service.addNote('admin-1', 'admin', 'waitlist', 'wl-1', 'hello');
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      targetType: 'advertiser_waitlist',
      targetId: 'wl-1',
    });
  });

  it('rejects an empty, blank or over-long body with 400 before any lookup', async () => {
    const { service, user, personNote } = makeService();
    for (const bad of ['', '   \n', 'x'.repeat(2001)]) {
      await expect(service.addNote('a', 'admin', 'user', 'u1', bad)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(user.findUnique).not.toHaveBeenCalled();
    expect(personNote.create).not.toHaveBeenCalled();
    personNote.create.mockResolvedValue(NOTE);
    await expect(
      service.addNote('a', 'admin', 'user', 'u1', 'x'.repeat(2000)),
    ).resolves.toBeDefined();
  });

  it('deletes a note and audits its subject without the body', async () => {
    const { service, personNote, auditLog } = makeService();
    personNote.findUnique.mockResolvedValue({
      id: 'n1',
      subjectType: 'waitlist',
      subjectId: 'wl-1',
    });
    await expect(service.deleteNote('admin-1', 'admin', 'n1')).resolves.toEqual({ deleted: true });
    expect(personNote.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1' } });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin_deleted_person_note',
        targetType: 'advertiser_waitlist',
        targetId: 'wl-1',
        beforeSnap: { subjectType: 'waitlist', noteId: 'n1' },
      }),
    );
  });

  it('404s for a missing note and when it vanished before the delete, without auditing', async () => {
    const { service, personNote, auditLog } = makeService();
    personNote.findUnique.mockResolvedValue(null);
    await expect(service.deleteNote('a', 'admin', 'n1')).rejects.toBeInstanceOf(NotFoundException);
    expect(personNote.deleteMany).not.toHaveBeenCalled();

    personNote.findUnique.mockResolvedValue({ id: 'n1', subjectType: 'user', subjectId: 'u1' });
    personNote.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.deleteNote('a', 'admin', 'n1')).rejects.toBeInstanceOf(NotFoundException);
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe('normalizeTags', () => {
  it('lowercases, trims, collapses duplicates and sorts', () => {
    expect(normalizeTags([' VIP ', 'vip', 'Beta-1', 'alpha'])).toEqual(['alpha', 'beta-1', 'vip']);
    expect(normalizeTags([])).toEqual([]);
  });

  it('rejects invalid tags with 400', () => {
    for (const bad of [
      '',
      '  ',
      '-leading',
      'has space',
      'under_score',
      'ünï',
      'a'.repeat(33),
      'semi;colon',
    ]) {
      expect(() => normalizeTags([bad])).toThrow(BadRequestException);
    }
    expect(() => normalizeTags('vip' as unknown as string[])).toThrow(BadRequestException);
    expect(() => normalizeTags([5 as unknown as string])).toThrow(BadRequestException);
  });

  it('accepts 32 characters and a leading digit', () => {
    expect(normalizeTags(['a'.repeat(32), '1st'])).toEqual(['1st', 'a'.repeat(32)]);
  });

  it('enforces at most 10 distinct tags (duplicates do not count)', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(normalizeTags([...ten, ...ten.map((t) => t.toUpperCase())])).toHaveLength(10);
    expect(() => normalizeTags([...ten, 'one-more'])).toThrow(BadRequestException);
  });
});

describe('PeopleNotesService tags', () => {
  it('replaces the set in one transaction, keeping unchanged tags untouched', async () => {
    const { service, personTag, tx, prisma } = makeService();
    personTag.findMany.mockResolvedValue([{ tag: 'old' }, { tag: 'keep' }]);
    const res = await service.setTags('admin-1', 'admin', 'user', 'u1', ['Keep', 'new', 'KEEP']);
    expect(res).toEqual({ tags: ['keep', 'new'] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1); // per-person advisory lock
    expect(personTag.deleteMany).toHaveBeenCalledWith({
      where: { subjectType: 'user', subjectId: 'u1', tag: { notIn: ['keep', 'new'] } },
    });
    expect(personTag.createMany).toHaveBeenCalledWith({
      data: [
        { subjectType: 'user', subjectId: 'u1', tag: 'keep' },
        { subjectType: 'user', subjectId: 'u1', tag: 'new' },
      ],
      skipDuplicates: true,
    });
  });

  it('clearing the set deletes everything and creates nothing', async () => {
    const { service, personTag } = makeService();
    personTag.findMany.mockResolvedValue([{ tag: 'old' }]);
    await expect(service.setTags('a', 'admin', 'waitlist', 'wl-1', [])).resolves.toEqual({
      tags: [],
    });
    expect(personTag.deleteMany).toHaveBeenCalledWith({
      where: { subjectType: 'waitlist', subjectId: 'wl-1', tag: { notIn: [] } },
    });
    expect(personTag.createMany).not.toHaveBeenCalled();
  });

  it('audits before and after tag lists', async () => {
    const { service, personTag, auditLog } = makeService();
    personTag.findMany.mockResolvedValue([{ tag: 'zeta' }, { tag: 'alpha' }]);
    await service.setTags('admin-1', 'super_admin', 'waitlist', 'wl-1', ['vip']);
    expect(auditLog).toHaveBeenCalledWith({
      actorId: 'admin-1',
      actorRole: 'super_admin',
      action: 'admin_set_person_tags',
      targetType: 'advertiser_waitlist',
      targetId: 'wl-1',
      beforeSnap: { subjectType: 'waitlist', tags: ['alpha', 'zeta'] },
      afterSnap: { subjectType: 'waitlist', tags: ['vip'] },
    });
  });

  it('does not audit when the set is unchanged', async () => {
    const { service, personTag, auditLog } = makeService();
    personTag.findMany.mockResolvedValue([{ tag: 'b' }, { tag: 'a' }]);
    await service.setTags('a', 'admin', 'user', 'u1', ['B', 'a']);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects invalid tags and an 11th tag before touching the database', async () => {
    const { service, user, prisma } = makeService();
    await expect(service.setTags('a', 'admin', 'user', 'u1', ['bad tag'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.setTags(
        'a',
        'admin',
        'user',
        'u1',
        Array.from({ length: 11 }, (_, i) => `t${i}`),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lists tags with counts for one subject type, most used first, max 200', async () => {
    const { service, personTag } = makeService();
    personTag.groupBy.mockResolvedValue([
      { tag: 'vip', _count: { _all: 5 } },
      { tag: 'beta', _count: { _all: 2 } },
    ]);
    await expect(service.listTags('user')).resolves.toEqual([
      { tag: 'vip', count: 5 },
      { tag: 'beta', count: 2 },
    ]);
    expect(personTag.groupBy).toHaveBeenCalledWith({
      by: ['tag'],
      where: { subjectType: 'user' },
      _count: { _all: true },
      orderBy: [{ _count: { tag: 'desc' } }, { tag: 'asc' }],
      take: 200,
    });
  });
});
