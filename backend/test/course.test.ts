import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createMemoryDb, migrate, type Db } from '../src/db.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
let db: Db;
let links: string[];

beforeEach(async () => {
  db = await createMemoryDb();
  await migrate(db);
  links = [];
  app = buildApp({
    config: loadConfig({ ADMIN_EMAILS: 'admin@example.com', TEACHER_EMAILS: 'teach@example.com' }),
    db,
    mailer: { sendLoginLink: async (_to, link) => void links.push(link) },
  });
});
afterEach(async () => {
  await app.close();
  await db.close();
});

async function login(email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/request', payload: { email } });
  const token = new URL(links[links.length - 1]).searchParams.get('login')!;
  return (await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } })).cookies[0].value;
}
const course = () => [
  { id: 'M1', lessons: [
    { id: '1.1', type: 'video', status: 'live', title: { nl: 'Hallo' } },
    { id: '1.2', type: 'practice', status: 'draft', items: [{ type: 'mc' }] },
  ] },
];
const put = (sid: string, body: unknown) => app.inject({ method: 'PUT', url: '/api/course', cookies: { tb_session: sid }, payload: body as object });
const get = (sid: string) => app.inject({ method: 'GET', url: '/api/course', cookies: { tb_session: sid } });

describe('roles from env', () => {
  it('assigns teacher and admin, learner otherwise, and upgrades existing users', async () => {
    const role = async (sid: string) => (await app.inject({ method: 'GET', url: '/api/me', cookies: { tb_session: sid } })).json().user.role;
    expect(await role(await login('teach@example.com'))).toBe('teacher');
    expect(await role(await login('admin@example.com'))).toBe('admin');
    expect(await role(await login('kid@example.com'))).toBe('learner');
    await db.query(`UPDATE users SET role = 'learner' WHERE email = 'teach@example.com'`);
    expect(await role(await login('teach@example.com'))).toBe('teacher');
  });

  it('does not downgrade manually promoted users', async () => {
    await login('kid@example.com');
    await db.query(`UPDATE users SET role = 'teacher' WHERE email = 'kid@example.com'`);
    const sid = await login('kid@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/me', cookies: { tb_session: sid } })).json().user.role).toBe('teacher');
  });
});

describe('course', () => {
  it('treats a missing status as published', async () => {
    const teacher = await login('teach@example.com');
    const c = [{ id: 'M1', lessons: [{ id: 'a', type: 'video' }, { id: 'b', type: 'video', status: 'draft' }] }];
    expect((await put(teacher, { course: c, baseVersion: 0 })).statusCode).toBe(200);
    const k = (await get(await login('kid@example.com'))).json();
    expect(k.course[0].lessons.map((l: { id: string }) => l.id)).toEqual(['a']);
  });

  it('requires login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/course' })).statusCode).toBe(401);
  });

  it('is empty until a teacher saves it', async () => {
    expect((await get(await login('kid@example.com'))).json()).toEqual({ course: null, version: 0 });
  });

  it('lets only staff save', async () => {
    const kid = await login('kid@example.com');
    expect((await put(kid, { course: course(), baseVersion: 0 })).statusCode).toBe(403);
  });

  it('saves, versions, and shows learners only published lessons', async () => {
    const teacher = await login('teach@example.com');
    const r = await put(teacher, { course: course(), baseVersion: 0 });
    expect(r.json()).toEqual({ ok: true, version: 1 });

    const t = (await get(teacher)).json();
    expect(t.version).toBe(1);
    expect(t.course[0].lessons).toHaveLength(2);

    const k = (await get(await login('kid@example.com'))).json();
    expect(k.course[0].lessons.map((l: { id: string }) => l.id)).toEqual(['1.1']);

    const next = course();
    next[0].lessons[1].status = 'live';
    expect((await put(teacher, { course: next, baseVersion: 1 })).json().version).toBe(2);
    expect((await get(await login('kid@example.com'))).json().course[0].lessons).toHaveLength(2);
  });

  it('rejects stale versions with 409 instead of overwriting', async () => {
    const teacher = await login('teach@example.com');
    const admin = await login('admin@example.com');
    await put(teacher, { course: course(), baseVersion: 0 });
    expect((await put(admin, { course: course(), baseVersion: 1 })).statusCode).toBe(200);
    const stale = await put(teacher, { course: course(), baseVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().version).toBe(2);
    expect((await put(admin, { course: course(), baseVersion: 0 })).statusCode).toBe(409); // создание поверх существующего
  });

  it('validates the shape', async () => {
    const teacher = await login('teach@example.com');
    const bad = [
      { course: [], baseVersion: 0 },
      { course: 'x', baseVersion: 0 },
      { course: course(), baseVersion: 'a' },
      { course: [{ id: 'M', lessons: [{ id: 'a', type: 'video', status: 'weird' }] }], baseVersion: 0 },
      { course: [{ id: 'M', lessons: [{ id: 'a', type: 'video', status: 'live' }, { id: 'a', type: 'video', status: 'live' }] }], baseVersion: 0 },
      { course: [{ id: 'M', lessons: [{ id: 'a', type: 'practice', status: 'live', items: [{ nope: 1 }] }] }], baseVersion: 0 },
    ];
    for (const b of bad) expect((await put(teacher, b)).statusCode).toBe(400);
  });
});
