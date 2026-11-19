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
  app = buildApp({ config: loadConfig({}), db, mailer: { sendLoginLink: async (_to, link) => void links.push(link) } });
});
afterEach(async () => {
  await app.close();
  await db.close();
});

async function login(email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/request', payload: { email } });
  const token = new URL(links[links.length - 1]).searchParams.get('login')!;
  const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
  return res.cookies[0].value;
}
const put = (sid: string, data: unknown) =>
  app.inject({ method: 'PUT', url: '/api/me/progress', cookies: { tb_session: sid }, payload: { data } });
const get = (sid: string) => app.inject({ method: 'GET', url: '/api/me/progress', cookies: { tb_session: sid } });

describe('progress', () => {
  it('requires login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me/progress' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/me/progress', payload: { data: {} } })).statusCode).toBe(401);
  });

  it('returns null before anything is saved, then the saved data', async () => {
    const sid = await login('a@example.com');
    expect((await get(sid)).json()).toEqual({ data: null, updatedAt: null });

    const data = { done: { '1.1': 1 }, scores: { '1.4': 80 }, known: { hallo: 1 }, cur: '2.3', streak: 5, week: [1, 2, 3, 4, 5, 6, 7] };
    expect((await put(sid, data)).statusCode).toBe(200);
    expect((await get(sid)).json().data).toEqual(data);
  });

  it('overwrites on the next save and keeps users separate', async () => {
    const a = await login('a@example.com');
    const b = await login('b@example.com');
    await put(a, { streak: 1 });
    await put(a, { streak: 2 });
    await put(b, { streak: 9 });
    expect((await get(a)).json().data).toEqual({ streak: 2 });
    expect((await get(b)).json().data).toEqual({ streak: 9 });
  });

  it('drops unknown fields and rejects wrong shapes', async () => {
    const sid = await login('a@example.com');
    await put(sid, { streak: 3, role: 'admin', groups: [1] });
    expect((await get(sid)).json().data).toEqual({ streak: 3 });

    expect((await put(sid, { done: [1, 2] })).statusCode).toBe(400);
    expect((await put(sid, { week: [1, 2] })).statusCode).toBe(400);
    expect((await put(sid, { streak: -1 })).statusCode).toBe(400);
    expect((await put(sid, 'nope')).statusCode).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const sid = await login('a@example.com');
    const big = { ex: { x: 'a'.repeat(600 * 1024) } };
    expect((await put(sid, big)).statusCode).toBe(413);
  });
});
