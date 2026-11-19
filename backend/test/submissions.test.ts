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
    config: loadConfig({ TEACHER_EMAILS: 'teach@example.com' }),
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
const as = (sid: string) => ({ tb_session: sid });
const submit = (sid: string, body: object) => app.inject({ method: 'POST', url: '/api/submissions', cookies: as(sid), payload: body });
const list = async (sid: string) => (await app.inject({ method: 'GET', url: '/api/submissions', cookies: as(sid) })).json().submissions;
const grade = (sid: string, id: string, body: object) => app.inject({ method: 'PATCH', url: `/api/submissions/${id}`, cookies: as(sid), payload: body });

describe('submissions', () => {
  it('requires login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/submissions' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/submissions', payload: {} })).statusCode).toBe(401);
  });

  it('learner submits once; staff sees all, learner only their own', async () => {
    const anna = await login('anna@example.com');
    const bob = await login('bob@example.com');
    const teacher = await login('teach@example.com');

    const r = await submit(anna, { lessonId: '1.5', itemIdx: 0, text: '  Ik heet Anna.  ' });
    expect(r.statusCode).toBe(200);
    expect((await submit(anna, { lessonId: '1.5', itemIdx: 0, text: 'again' })).statusCode).toBe(409);
    await submit(bob, { lessonId: '1.5', itemIdx: 0, text: 'Ik ben Bob.' });

    const mine = await list(anna);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ lessonId: '1.5', text: 'Ik heet Anna.', status: 'new', who: 'anna' });

    const all = await list(teacher);
    expect(all.map((s: { who: string }) => s.who).sort()).toEqual(['anna', 'bob']);
  });

  it('validates input', async () => {
    const anna = await login('anna@example.com');
    for (const b of [
      { lessonId: '', itemIdx: 0, text: 'x' },
      { lessonId: '1.5', itemIdx: -1, text: 'x' },
      { lessonId: '1.5', itemIdx: 'a', text: 'x' },
      { lessonId: '1.5', itemIdx: 0, text: '   ' },
      { lessonId: '1.5', itemIdx: 0, text: 'a'.repeat(5001) },
    ]) expect((await submit(anna, b)).statusCode).toBe(400);
  });

  it('only teachers grade; the learner then sees grade and feedback', async () => {
    const anna = await login('anna@example.com');
    const teacher = await login('teach@example.com');
    const { id } = (await submit(anna, { lessonId: '1.5', itemIdx: 0, text: 'Ik heet Anna.' })).json();

    expect((await grade(anna, id, { grade: 0, feedback: 'self' })).statusCode).toBe(403);
    expect((await grade(teacher, id, { grade: 5, feedback: '' })).statusCode).toBe(400);
    expect((await grade(teacher, '999', { grade: 0, feedback: '' })).statusCode).toBe(404);
    expect((await grade(teacher, id, { grade: 1, feedback: 'Goed bezig' })).statusCode).toBe(200);

    expect((await list(anna))[0]).toMatchObject({ status: 'done', grade: 1, feedback: 'Goed bezig' });
  });

  it('checks the lesson against the server course when one exists', async () => {
    const anna = await login('anna@example.com');
    const teacher = await login('teach@example.com');
    const course = [{ id: 'M1', lvl: 'A0', lessons: [
      { id: 'w', type: 'writing', status: 'live', items: [{ type: 'mc' }, { type: 'write' }] },
      { id: 'd', type: 'writing', status: 'draft', items: [{ type: 'write' }] },
    ] }];
    await app.inject({ method: 'PUT', url: '/api/course', cookies: as(teacher), payload: { course, baseVersion: 0 } });

    expect((await submit(anna, { lessonId: 'w', itemIdx: 0, text: 'x' })).statusCode).toBe(400); // не write
    expect((await submit(anna, { lessonId: 'd', itemIdx: 0, text: 'x' })).statusCode).toBe(400); // черновик
    expect((await submit(anna, { lessonId: 'zzz', itemIdx: 0, text: 'x' })).statusCode).toBe(400);
    expect((await submit(anna, { lessonId: 'w', itemIdx: 1, text: 'x' })).statusCode).toBe(200);
  });
});
