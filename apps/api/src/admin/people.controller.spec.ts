import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { PeopleController } from './people.controller';
import type { PeopleService } from './people.service';
import type { PeopleNotesService } from './people-notes.service';
import { PersonSubjectPipe } from './people-subject.pipe';

function makeController() {
  const service = {
    listUsers: vi.fn().mockResolvedValue({ rows: [] }),
    listWaitlist: vi.fn().mockResolvedValue({ rows: [] }),
    exportPeople: vi.fn().mockResolvedValue({ rows: [] }),
  };
  const notes = {
    listTags: vi.fn().mockResolvedValue([]),
    listNotes: vi.fn(),
    addNote: vi.fn(),
    deleteNote: vi.fn(),
    setTags: vi.fn(),
  };
  return {
    controller: new PeopleController(
      service as unknown as PeopleService,
      notes as unknown as PeopleNotesService,
    ),
    service,
    notes,
  };
}

describe('PeopleController query params', () => {
  it('rejects a repeated key with 400 instead of crashing on an array', () => {
    const { controller, service } = makeController();
    expect(() => controller.listUsers(['a', 'b'])).toThrow(BadRequestException);
    expect(() => controller.listWaitlist(undefined, undefined, undefined, ['1', '2'])).toThrow(
      BadRequestException,
    );
    expect(service.listUsers).not.toHaveBeenCalled();
  });

  it('passes single values through and parses pagination', () => {
    const { controller, service } = makeController();
    controller.listWaitlist('acme', 'pending', 'us', '2', '50');
    expect(service.listWaitlist).toHaveBeenCalledWith(
      { search: 'acme', status: 'pending', country: 'us' },
      { page: 2, limit: 50 },
    );
  });

  it('passes the tag filter to lists and export, and rejects a repeated tag', () => {
    const { controller, service } = makeController();
    controller.listUsers(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'vip',
    );
    expect(service.listUsers.mock.calls[0][0]).toMatchObject({ tag: 'vip' });
    controller.listWaitlist(undefined, undefined, undefined, undefined, undefined, 'warm');
    expect(service.listWaitlist.mock.calls[0][0]).toMatchObject({ tag: 'warm' });
    controller.exportPeople(
      'a',
      'admin',
      'users',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'vip',
    );
    expect(service.exportPeople.mock.calls[0][3]).toMatchObject({ tag: 'vip' });
    expect(() =>
      controller.listWaitlist(undefined, undefined, undefined, undefined, undefined, ['a', 'b']),
    ).toThrow(BadRequestException);
  });

  it('maps the tags endpoint subject query and rejects a bad or missing one', () => {
    const { controller, notes } = makeController();
    controller.listTags('users');
    expect(notes.listTags).toHaveBeenCalledWith('user');
    controller.listTags('waitlist');
    expect(notes.listTags).toHaveBeenCalledWith('waitlist');
    expect(() => controller.listTags('admins')).toThrow(BadRequestException);
    expect(() => controller.listTags()).toThrow(BadRequestException);
    expect(() => controller.listTags(['users', 'waitlist'])).toThrow(BadRequestException);
  });
});

describe('PersonSubjectPipe', () => {
  const pipe = new PersonSubjectPipe();
  it('maps users and waitlist, rejects anything else with 400', () => {
    expect(pipe.transform('users')).toBe('user');
    expect(pipe.transform('waitlist')).toBe('waitlist');
    for (const bad of ['user', 'Users', 'summary', '', undefined]) {
      expect(() => pipe.transform(bad)).toThrow(BadRequestException);
    }
  });
});
