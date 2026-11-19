import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createMemoryDb, migrate, type Db } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { canonicalCode, gateCourse, isFreeModule } from '../src/access.js';

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
    mailer: { sendLoginLink: async (_t, l) => void links.push(l) },
  });
});
afterEach(async () => {
  await app.close();
  await db.close();
});

async function login(email: string): Promise<Record<string, string>> {
  await app.inject({ method: 'POST', url: '/api/auth/request', payload: { email } });
  const token = new URL(links[links.length - 1]).searchParams.get('login')!;
  return { tb_session: (await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } })).cookies[0].value };
}
const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookies?: Record<string, string>, payload?: object) =>
  app.inject({ method, url, cookies, payload });

const course = () => [
  { id: 'M1', lvl: 'A0', title: { nl: 'Kennismaken' }, lessons: [{ id: '1.1', type: 'words', min: 5, title: { nl: 'Woorden' }, words: [['hallo', 'привіт']], status: 'live' }] },
  { id: 'M2', lvl: 'A1', title: { nl: 'Huisarts' }, lessons: [
    { id: '2.1', type: 'words', min: 5, title: { nl: 'Het lichaam' }, words: [['de arm', 'рука']], status: 'live' },
    { id: '2.2', type: 'writing', min: 8, title: { nl: 'Schrijven' }, items: [{ type: 'write', prompt: { nl: 'Schrijf' }, model: 'ANTWOORD' }], status: 'live' },
  ] },
  { id: 'M3', lvl: 'A2', access: 'free', title: { nl: 'Gratis A2' }, lessons: [{ id: '3.1', type: 'words', min: 5, title: { nl: 'Proef' }, words: [['x', 'y']], status: 'live' }] },
];
async function seedCourse() {
  const teacher = await login('teach@example.com');
  await call('PUT', '/api/course', teacher, { course: course(), baseVersion: 0 });
}
const lessonsOf = (res: { json(): { course: { id: string; locked?: boolean; lessons: Record<string, unknown>[] }[] } }) => res.json().course;

describe('access rules', () => {
  it('free by default only for A0, access field overrides', () => {
    expect(isFreeModule({ id: 'a', lvl: 'A0', lessons: [] })).toBe(true);
    expect(isFreeModule({ id: 'a', lvl: 'A1', lessons: [] })).toBe(false);
    expect(isFreeModule({ id: 'a', lvl: 'A1', access: 'free', lessons: [] })).toBe(true);
    expect(isFreeModule({ id: 'a', lvl: 'A0', access: 'paid', lessons: [] })).toBe(false);
  });
  it('normalises codes', () => {
    expect(canonicalCode('tb-abcd-2345')).toBe('ABCD2345');
    expect(canonicalCode(' ABCD 2345 ')).toBe('ABCD2345');
    expect(canonicalCode('ABCD0123')).toBeNull(); // 0 и 1 не бывают в кодах
    expect(canonicalCode('short')).toBeNull();
    expect(canonicalCode(5)).toBeNull();
  });
  it('gateCourse strips content but keeps titles', () => {
    const g = gateCourse(course() as never, new Set());
    expect(g[0].locked).toBeUndefined();
    expect(g[1].locked).toBe(true);
    expect(g[1].lessons[0]).toEqual({ id: '2.1', type: 'words', min: 5, title: { nl: 'Het lichaam' }, status: 'live' });
    expect(g[2].locked).toBeUndefined();
    expect(gateCourse(course() as never, new Set(['A1']))[1].locked).toBeUndefined();
  });
});

describe('course gating on the server', () => {
  it('learner gets free modules in full and locked ones as shells; staff see everything', async () => {
    await seedCourse();
    const kid = await login('kid@example.com');
    const res = await call('GET', '/api/course', kid);
    const c = lessonsOf(res);
    expect(c[0].lessons[0].words).toBeTruthy();
    expect(c[1].locked).toBe(true);
    expect(JSON.stringify(c[1])).not.toMatch(/ANTWOORD|de arm|"words":|"items":/);
    expect(c[1].lessons.map((l) => l.id)).toEqual(['2.1', '2.2']);
    expect(c[2].locked).toBeUndefined();
    expect(res.json().entitlements).toEqual([]);

    const t = lessonsOf(await call('GET', '/api/course', await login('teach@example.com')));
    expect(t[1].locked).toBeUndefined();
    expect(JSON.stringify(t[1])).toMatch(/ANTWOORD/);
  });

  it('does not accept submissions for locked lessons', async () => {
    await seedCourse();
    const kid = await login('kid@example.com');
    const body = { lessonId: '2.2', itemIdx: 0, text: 'Ik heet Olena.' };
    expect((await call('POST', '/api/submissions', kid, body)).statusCode).toBe(403);
    const admin = await login('admin@example.com');
    await call('POST', '/api/admin/entitlements', admin, { email: 'kid@example.com', level: 'A1' });
    expect((await call('POST', '/api/submissions', kid, body)).statusCode).toBe(200);
  });
});

describe('manual entitlements (admin only)', () => {
  it('grants and revokes by email; others are forbidden', async () => {
    await seedCourse();
    const kid = await login('kid@example.com');
    const teacher = await login('teach@example.com');
    const admin = await login('admin@example.com');
    const body = { email: 'kid@example.com', level: 'A1' };
    expect((await call('POST', '/api/admin/entitlements', undefined, body)).statusCode).toBe(401);
    expect((await call('POST', '/api/admin/entitlements', kid, body)).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/entitlements', teacher, body)).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/entitlements', admin, { ...body, level: 'Z9' })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/entitlements', admin, { ...body, email: 'nobody@example.com' })).statusCode).toBe(404);

    expect((await call('POST', '/api/admin/entitlements', admin, body)).json().levels).toEqual(['A1']);
    expect(lessonsOf(await call('GET', '/api/course', kid))[1].locked).toBeUndefined();
    expect((await call('GET', '/api/me/entitlements', kid)).json().levels).toEqual(['A1']);

    expect((await call('DELETE', '/api/admin/entitlements', admin, body)).json().levels).toEqual([]);
    expect(lessonsOf(await call('GET', '/api/course', kid))[1].locked).toBe(true);
  });
});

describe('access codes', () => {
  it('only admins create and list codes; the code is not stored in plain text', async () => {
    const kid = await login('kid@example.com');
    const admin = await login('admin@example.com');
    expect((await call('POST', '/api/admin/codes', kid, { level: 'A1', seats: 3 })).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/codes', admin, { level: 'X', seats: 3 })).statusCode).toBe(400);
    expect((await call('POST', '/api/admin/codes', admin, { level: 'A1', seats: 0 })).statusCode).toBe(400);
    const made = (await call('POST', '/api/admin/codes', admin, { level: 'A1', seats: 3, label: 'Gemeente Utrecht' })).json();
    expect(made.code).toMatch(/^TB-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const listed = (await call('GET', '/api/admin/codes', admin)).json().codes;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(made.code.replace(/-/g, '').slice(2));
    expect(listed[0]).toMatchObject({ level: 'A1', seats: 3, used: 0, label: 'Gemeente Utrecht', revoked: false });
  });

  it('redeems once per user, counts seats, grants the level', async () => {
    await seedCourse();
    const admin = await login('admin@example.com');
    const { code } = (await call('POST', '/api/admin/codes', admin, { level: 'A1', seats: 2 })).json();
    const a = await login('a@example.com');
    const b = await login('b@example.com');
    const c = await login('c@example.com');

    expect((await call('POST', '/api/me/redeem', undefined, { code })).statusCode).toBe(401);
    const r = await call('POST', '/api/me/redeem', a, { code: code.toLowerCase() });
    expect(r.json()).toMatchObject({ ok: true, level: 'A1', levels: ['A1'] });
    expect(lessonsOf(await call('GET', '/api/course', a))[1].locked).toBeUndefined();

    expect((await call('POST', '/api/me/redeem', a, { code })).statusCode).toBe(200); // повтор не занимает место
    expect((await call('POST', '/api/me/redeem', b, { code })).statusCode).toBe(200);
    expect((await call('POST', '/api/me/redeem', c, { code })).statusCode).toBe(409); // места кончились
    expect((await call('GET', '/api/admin/codes', admin)).json().codes[0].used).toBe(2);
    expect((await call('GET', '/api/me/entitlements', c)).json().levels).toEqual([]);
  });

  it('rejects wrong, revoked and expired codes, and limits guessing', async () => {
    const admin = await login('admin@example.com');
    const kid = await login('kid@example.com');
    expect((await call('POST', '/api/me/redeem', kid, { code: 'TB-AAAA-BBBB' })).statusCode).toBe(404);
    expect((await call('POST', '/api/me/redeem', kid, { code: 'nonsense' })).statusCode).toBe(400);

    const rev = (await call('POST', '/api/admin/codes', admin, { level: 'A1', seats: 5 })).json();
    expect((await call('PATCH', `/api/admin/codes/${rev.id}`, admin)).statusCode).toBe(200);
    expect((await call('POST', '/api/me/redeem', kid, { code: rev.code })).statusCode).toBe(404);

    const exp = (await call('POST', '/api/admin/codes', admin, { level: 'A1', seats: 5, days: 1 })).json();
    await db.query(`UPDATE access_codes SET expires_at = now() - interval '1 hour' WHERE id = $1`, [exp.id]);
    expect((await call('POST', '/api/me/redeem', kid, { code: exp.code })).statusCode).toBe(404);

    for (let i = 0; i < 12; i++) await call('POST', '/api/me/redeem', kid, { code: 'TB-AAAA-BBBB' });
    const good = (await call('POST', '/api/admin/codes', admin, { level: 'A1', seats: 5 })).json();
    expect((await call('POST', '/api/me/redeem', kid, { code: good.code })).statusCode).toBe(429);
  });
});
