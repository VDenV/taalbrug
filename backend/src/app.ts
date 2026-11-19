import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Mailer } from './mailer.js';
import { sanitizeProgress } from './progress.js';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LINKS_PER_WINDOW = 5;
const COOKIE = 'tb_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: 'learner' | 'teacher' | 'admin' | 'client';
  lang: 'nl' | 'uk';
}

export async function userFromRequest(db: Db, req: FastifyRequest): Promise<SessionUser | null> {
  const sid = req.cookies[COOKIE];
  if (!sid) return null;
  const rows = await db.query<SessionUser>(
    `SELECT u.id::text AS id, u.email, u.name, u.role, u.lang
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1 AND s.expires_at > now()`,
    [sha256(sid)],
  );
  return rows[0] ?? null;
}

export function buildApp(deps: { config: Config; db: Db; mailer: Mailer }): FastifyInstance {
  const { config, db, mailer } = deps;
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 512 * 1024 });
  app.register(cookie);

  if (config.staticFile) {
    const file = config.staticFile;
    app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(await readFile(file)));
  }

  app.get('/api/health', async () => ({ ok: true }));

  // Запрос ссылки для входа. Ответ всегда одинаковый, чтобы не раскрывать, есть ли email в базе.
  app.post('/api/auth/request', async (req, reply) => {
    const email = String((req.body as { email?: unknown } | null)?.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return reply.code(400).send({ error: 'invalid_email' });

    const role = config.adminEmails.includes(email) ? 'admin' : 'learner';
    const [user] = await db.query<{ id: string }>(
      `INSERT INTO users(email, role) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id::text AS id`,
      [email, role],
    );

    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM login_tokens
        WHERE user_id = $1 AND created_at > now() - interval '15 minutes'`,
      [user.id],
    );
    if (n < MAX_LINKS_PER_WINDOW) {
      const token = newSecret();
      await db.query('INSERT INTO login_tokens(token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
        sha256(token),
        user.id,
        new Date(Date.now() + TOKEN_TTL_MS),
      ]);
      await mailer.sendLoginLink(email, `${config.baseUrl}/?login=${token}`);
    }
    return { ok: true };
  });

  // Обмен одноразового токена на сессию. POST, чтобы почтовые сканеры ссылок не сжигали токен.
  app.post('/api/auth/verify', async (req, reply) => {
    const token = String((req.body as { token?: unknown } | null)?.token ?? '');
    if (!token) return reply.code(400).send({ error: 'invalid_token' });

    const rows = await db.query<{ user_id: string }>(
      `UPDATE login_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id::text AS user_id`,
      [sha256(token)],
    );
    if (!rows[0]) return reply.code(401).send({ error: 'invalid_or_expired' });

    const sid = newSecret();
    await db.query('INSERT INTO sessions(id_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      sha256(sid),
      rows[0].user_id,
      new Date(Date.now() + SESSION_TTL_MS),
    ]);
    reply.setCookie(COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = req.cookies[COOKIE];
    if (sid) await db.query('DELETE FROM sessions WHERE id_hash = $1', [sha256(sid)]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return { user };
  });

  app.get('/api/me/progress', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await db.query<{ data: Record<string, unknown>; updated_at: string }>(
      'SELECT data, updated_at FROM progress WHERE user_id = $1',
      [user.id],
    );
    return rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : { data: null, updatedAt: null };
  });

  app.put('/api/me/progress', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const data = sanitizeProgress((req.body as { data?: unknown } | null)?.data);
    if (!data) return reply.code(400).send({ error: 'invalid_progress' });
    await db.query(
      `INSERT INTO progress(user_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [user.id, JSON.stringify(data)],
    );
    return { ok: true };
  });

  return app;
}
