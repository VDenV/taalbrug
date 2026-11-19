import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createMemoryDb, migrate, type Db } from '../src/db.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
let db: Db;
let links: { to: string; link: string }[];

beforeEach(async () => {
  db = await createMemoryDb();
  await migrate(db);
  links = [];
  const config = loadConfig({ BASE_URL: 'https://taalbrug.example', ADMIN_EMAILS: 'boss@example.com' });
  app = buildApp({ config, db, mailer: { sendLoginLink: async (to, link) => void links.push({ to, link }) } });
});
afterEach(async () => {
  await app.close();
  await db.close();
});

const tokenOf = (link: string) => new URL(link).searchParams.get('login')!;
const request = (email: string) => app.inject({ method: 'POST', url: '/api/auth/request', payload: { email } });
const verify = (token: string) => app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });

describe('magic-link auth', () => {
  it('rejects an invalid email', async () => {
    expect((await request('nope')).statusCode).toBe(400);
  });

  it('logs in with the emailed link and returns the user', async () => {
    expect((await request('Anna@Example.com')).statusCode).toBe(200);
    expect(links).toHaveLength(1);
    expect(links[0].to).toBe('anna@example.com');

    const res = await verify(tokenOf(links[0].link));
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'tb_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);

    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { tb_session: cookie.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: 'anna@example.com', role: 'learner' });
  });

  it('makes configured admin emails admins', async () => {
    await request('boss@example.com');
    const res = await verify(tokenOf(links[0].link));
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { tb_session: res.cookies[0].value } });
    expect(me.json().user.role).toBe('admin');
  });

  it('allows each link only once', async () => {
    await request('a@example.com');
    const t = tokenOf(links[0].link);
    expect((await verify(t)).statusCode).toBe(200);
    expect((await verify(t)).statusCode).toBe(401);
  });

  it('rejects expired and unknown tokens', async () => {
    await request('a@example.com');
    await db.query(`UPDATE login_tokens SET expires_at = now() - interval '1 minute'`);
    expect((await verify(tokenOf(links[0].link))).statusCode).toBe(401);
    expect((await verify('garbage')).statusCode).toBe(401);
  });

  it('limits link requests per user', async () => {
    for (let i = 0; i < 8; i++) await request('spam@example.com');
    expect(links).toHaveLength(5);
  });

  it('requires a session for /api/me and ends it on logout', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    await request('a@example.com');
    const sid = (await verify(tokenOf(links[0].link))).cookies[0].value;
    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { tb_session: sid } });
    expect((await app.inject({ method: 'GET', url: '/api/me', cookies: { tb_session: sid } })).statusCode).toBe(401);
  });
});
