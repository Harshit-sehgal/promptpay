import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AdminMfaStepUpGuard } from '../common/guards/admin-mfa-step-up.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { PeopleNotesService } from './people-notes.service';

const ID = '3f0c1d52-8a3e-4c8b-9d0e-5a1b2c3d4e5f';
const NOTE_ID = '9b1f7a64-2c3d-4e5f-8a9b-0c1d2e3f4a5b';

/**
 * Routing and body validation through the real Nest pipeline (global
 * ValidationPipe with the production options), services mocked.
 */
describe('People notes and tags HTTP routing', () => {
  let app: INestApplication;
  const people = {
    summary: vi.fn().mockResolvedValue({ route: 'summary' }),
    getUser: vi.fn().mockResolvedValue({ route: 'user-detail' }),
    listUsers: vi.fn().mockResolvedValue({ route: 'users' }),
  };
  const notes = {
    listTags: vi.fn().mockResolvedValue([{ tag: 'vip', count: 2 }]),
    listNotes: vi.fn().mockResolvedValue([]),
    addNote: vi.fn().mockResolvedValue({ id: NOTE_ID }),
    deleteNote: vi.fn().mockResolvedValue({ deleted: true }),
    setTags: vi.fn().mockResolvedValue({ tags: ['vip'] }),
  };
  const allow = {
    canActivate: (ctx: { switchToHttp(): { getRequest(): { user?: unknown } } }) => {
      ctx.switchToHttp().getRequest().user = { id: 'admin-1', role: 'admin' };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PeopleController],
      providers: [
        { provide: PeopleService, useValue: people },
        { provide: PeopleNotesService, useValue: notes },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminMfaStepUpGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /tags is not shadowed by a parameterised route', async () => {
    const res = await request(app.getHttpServer()).get('/admin/people/tags?subject=users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ tag: 'vip', count: 2 }]);
    expect(notes.listTags).toHaveBeenCalledWith('user');
  });

  it('GET /tags without a valid subject is 400', async () => {
    expect((await request(app.getHttpServer()).get('/admin/people/tags')).status).toBe(400);
    expect(
      (await request(app.getHttpServer()).get('/admin/people/tags?subject=admins')).status,
    ).toBe(400);
  });

  it('DELETE /notes/:noteId reaches deleteNote with the actor', async () => {
    const res = await request(app.getHttpServer()).delete(`/admin/people/notes/${NOTE_ID}`);
    expect(res.status).toBe(200);
    expect(notes.deleteNote).toHaveBeenCalledWith('admin-1', 'admin', NOTE_ID);
    expect(
      (await request(app.getHttpServer()).delete('/admin/people/notes/not-a-uuid')).status,
    ).toBe(400);
  });

  it('keeps the existing literal routes working', async () => {
    expect((await request(app.getHttpServer()).get('/admin/people/summary')).body.route).toBe(
      'summary',
    );
    expect((await request(app.getHttpServer()).get(`/admin/people/users/${ID}`)).body.route).toBe(
      'user-detail',
    );
  });

  it('validates :subject and :id on notes routes', async () => {
    const http = request(app.getHttpServer());
    expect((await http.get(`/admin/people/admins/${ID}/notes`)).status).toBe(400);
    expect((await http.get('/admin/people/users/not-a-uuid/notes')).status).toBe(400);
    expect((await http.get(`/admin/people/waitlist/${ID}/notes`)).status).toBe(200);
    expect(notes.listNotes).toHaveBeenCalledWith('waitlist', ID);
  });

  it('POST notes validates the body (trim, 1 to 2000 chars, no extra fields)', async () => {
    const post = (body: unknown) =>
      request(app.getHttpServer())
        .post(`/admin/people/users/${ID}/notes`)
        .send(body as object);
    expect((await post({ body: '' })).status).toBe(400);
    expect((await post({ body: '   ' })).status).toBe(400);
    expect((await post({ body: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post({ body: 5 })).status).toBe(400);
    expect((await post({ body: 'hi', authorId: 'someone' })).status).toBe(400);
    expect(notes.addNote).not.toHaveBeenCalled();

    expect((await post({ body: '  call back Friday  ' })).status).toBe(201);
    expect(notes.addNote).toHaveBeenCalledWith('admin-1', 'admin', 'user', ID, 'call back Friday');
    expect((await post({ body: 'x'.repeat(2000) })).status).toBe(201);
  });

  it('PUT tags validates the body shape and reaches setTags', async () => {
    const put = (body: unknown) =>
      request(app.getHttpServer())
        .put(`/admin/people/waitlist/${ID}/tags`)
        .send(body as object);
    expect((await put({})).status).toBe(400);
    expect((await put({ tags: 'vip' })).status).toBe(400);
    expect((await put({ tags: [1] })).status).toBe(400);
    expect((await put({ tags: ['a'], extra: true })).status).toBe(400);
    expect(notes.setTags).not.toHaveBeenCalled();

    const ok = await put({ tags: ['VIP'] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ tags: ['vip'] });
    expect(notes.setTags).toHaveBeenCalledWith('admin-1', 'admin', 'waitlist', ID, ['VIP']);
  });
});
