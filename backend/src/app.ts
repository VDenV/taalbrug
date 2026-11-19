import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Mailer } from './mailer.js';
import { sanitizeProgress } from './progress.js';
import { publishedOnly, validateCourse, type Course } from './course.js';
import { answer as placementAnswer, cryptoRng, initState, present, type Result, type State } from './placement.js';

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

    // Роли из окружения: admin важнее teacher; для остальных роль не трогаем (её меняет администратор).
    const envRole = config.adminEmails.includes(email) ? 'admin' : config.teacherEmails.includes(email) ? 'teacher' : null;
    const [user] = await db.query<{ id: string }>(
      `INSERT INTO users(email, role) VALUES ($1, COALESCE($2, 'learner'))
       ON CONFLICT (email) DO UPDATE SET role = COALESCE($2, users.role)
       RETURNING id::text AS id`,
      [email, envRole],
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

  const STAFF = new Set(['teacher', 'admin']);

  app.get('/api/course', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await db.query<{ data: Course; version: number }>('SELECT data, version FROM course WHERE id = 1');
    if (!rows[0]) return { course: null, version: 0 };
    const course = STAFF.has(user.role) ? rows[0].data : publishedOnly(rows[0].data);
    return { course, version: rows[0].version };
  });

  // Сохранение курса. baseVersion защищает от затирания чужих правок: при расхождении 409.
  app.put('/api/course', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!STAFF.has(user.role)) return reply.code(403).send({ error: 'forbidden' });
    const body = (req.body ?? {}) as { course?: unknown; baseVersion?: unknown };
    const course = validateCourse(body.course);
    if (!course || !Number.isInteger(body.baseVersion)) return reply.code(400).send({ error: 'invalid_course' });

    const json = JSON.stringify(course);
    const rows = body.baseVersion === 0
      ? await db.query<{ version: number }>(
          `INSERT INTO course(id, data, updated_by) VALUES (1, $1::jsonb, $2)
           ON CONFLICT (id) DO NOTHING RETURNING version`,
          [json, user.id],
        )
      : await db.query<{ version: number }>(
          `UPDATE course SET data = $1::jsonb, version = version + 1, updated_by = $2, updated_at = now()
            WHERE id = 1 AND version = $3 RETURNING version`,
          [json, user.id, body.baseVersion],
        );
    if (!rows[0]) {
      const cur = await db.query<{ version: number }>('SELECT version FROM course WHERE id = 1');
      return reply.code(409).send({ error: 'version_conflict', version: cur[0]?.version ?? 0 });
    }
    return { ok: true, version: rows[0].version };
  });

  // ---- письменные работы ----
  const SUB_COLS = `s.id::text AS id, s.user_id::text AS "userId", s.lesson_id AS "lessonId", s.item_idx AS "itemIdx",
    s.text, s.status, s.grade, s.feedback, s.created_at AS "createdAt",
    COALESCE(NULLIF(u.name, ''), split_part(u.email, '@', 1)) AS who`;

  app.get('/api/submissions', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const own = !STAFF.has(user.role);
    const rows = await db.query(
      `SELECT ${SUB_COLS} FROM submissions s JOIN users u ON u.id = s.user_id
        ${own ? 'WHERE s.user_id = $1' : ''} ORDER BY s.created_at DESC LIMIT 500`,
      own ? [user.id] : [],
    );
    return { submissions: rows };
  });

  app.post('/api/submissions', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const b = (req.body ?? {}) as { lessonId?: unknown; itemIdx?: unknown; text?: unknown };
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (typeof b.lessonId !== 'string' || !b.lessonId || b.lessonId.length > 64 ||
        !Number.isInteger(b.itemIdx) || (b.itemIdx as number) < 0 || !text || text.length > 5000) {
      return reply.code(400).send({ error: 'invalid_submission' });
    }
    // Если курс уже на сервере, работа должна относиться к упражнению типа write в опубликованном уроке.
    const cr = await db.query<{ data: Course }>('SELECT data FROM course WHERE id = 1');
    if (cr[0]) {
      const lesson = cr[0].data.flatMap((m) => m.lessons).find((l) => l.id === b.lessonId);
      const item = (lesson?.items as { type?: string }[] | undefined)?.[b.itemIdx as number];
      if (!lesson || lesson.status === 'draft' || item?.type !== 'write') {
        return reply.code(400).send({ error: 'invalid_submission' });
      }
    }
    const rows = await db.query<{ id: string }>(
      `INSERT INTO submissions(user_id, lesson_id, item_idx, text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, lesson_id, item_idx) DO NOTHING RETURNING id::text AS id`,
      [user.id, b.lessonId, b.itemIdx, text],
    );
    if (!rows[0]) return reply.code(409).send({ error: 'already_submitted' });
    return { ok: true, id: rows[0].id };
  });

  app.patch('/api/submissions/:id', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!STAFF.has(user.role)) return reply.code(403).send({ error: 'forbidden' });
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { grade?: unknown; feedback?: unknown };
    const feedback = typeof b.feedback === 'string' ? b.feedback.trim() : '';
    if (!/^\d+$/.test(id) || !Number.isInteger(b.grade) || (b.grade as number) < 0 || (b.grade as number) > 2 || feedback.length > 2000) {
      return reply.code(400).send({ error: 'invalid_grade' });
    }
    const rows = await db.query(
      `UPDATE submissions SET status = 'done', grade = $1, feedback = $2, graded_by = $3, graded_at = now()
        WHERE id = $4 RETURNING id`,
      [b.grade, feedback, user.id, id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ---- тест уровня (адаптивный) ----
  // Вопросы и ответы хранятся на сервере: клиент получает по одному вопросу и не видит верных ответов.
  const starts = new Map<string, number[]>();
  const startAllowed = (ip: string) => {
    const now = Date.now();
    const recent = (starts.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 30) return false;
    recent.push(now);
    starts.set(ip, recent);
    return true;
  };
  type PRow = { state: State; step: number; status: 'active' | 'done'; result: Result | null };
  const loadPlacement = async (token: unknown) => {
    if (typeof token !== 'string' || !token || token.length > 128) return null;
    const rows = await db.query<PRow>('SELECT state, step, status, result FROM placement_sessions WHERE id_hash = $1', [sha256(token)]);
    return rows[0] ?? null;
  };
  const progressView = (st: State, step: number) => ({ n: step + 1, max: MAX_Q, question: present(st) });
  const MAX_Q = 14;

  app.post('/api/placement/start', async (req, reply) => {
    if (!startAllowed(req.ip)) return reply.code(429).send({ error: 'too_many_requests' });
    const user = await userFromRequest(db, req);
    const token = newSecret();
    const state = initState(cryptoRng);
    await db.query('INSERT INTO placement_sessions(id_hash, user_id, state) VALUES ($1, $2, $3::jsonb)', [
      sha256(token),
      user?.id ?? null,
      JSON.stringify(state),
    ]);
    return { token, ...progressView(state, 0) };
  });

  // Продолжить после перезагрузки страницы.
  app.post('/api/placement/resume', async (req, reply) => {
    const row = await loadPlacement((req.body as { token?: unknown } | null)?.token);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.status === 'done') return { done: true, result: row.result };
    return { done: false, ...progressView(row.state, row.step) };
  });

  app.post('/api/placement/answer', async (req, reply) => {
    const b = (req.body ?? {}) as { token?: unknown; n?: unknown; choice?: unknown };
    const row = await loadPlacement(b.token);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.status === 'done') return reply.code(409).send({ error: 'already_done', result: row.result });
    const q = present(row.state);
    const choice = b.choice === null ? null : b.choice;
    if (b.n !== row.step + 1) return reply.code(409).send({ error: 'out_of_sync', n: row.step + 1 });
    if (choice !== null && (!Number.isInteger(choice) || (choice as number) < 0 || (choice as number) >= (q?.options.length ?? 0))) {
      return reply.code(400).send({ error: 'invalid_choice' });
    }
    const out = placementAnswer(row.state, choice as number | null, cryptoRng);
    const done = out.done;
    const upd = await db.query(
      `UPDATE placement_sessions SET state = $1::jsonb, step = step + 1, status = $2, result = $3::jsonb, updated_at = now()
        WHERE id_hash = $4 AND step = $5 RETURNING step`,
      [JSON.stringify(row.state), done ? 'done' : 'active', done ? JSON.stringify(out.result) : null, sha256(String(b.token)), row.step],
    );
    if (!upd[0]) return reply.code(409).send({ error: 'out_of_sync', n: row.step + 1 });
    return out.done ? { done: true, result: out.result } : { done: false, n: row.step + 2, max: MAX_Q, question: out.question };
  });

  // Привязать завершённый тест к вошедшему пользователю.
  app.post('/api/placement/claim', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const token = (req.body as { token?: unknown } | null)?.token;
    const row = await loadPlacement(token);
    if (!row || row.status !== 'done') return reply.code(404).send({ error: 'not_found' });
    await db.query('UPDATE placement_sessions SET user_id = $1 WHERE id_hash = $2 AND user_id IS NULL', [user.id, sha256(String(token))]);
    return { result: row.result };
  });

  app.get('/api/me/placement', async (req, reply) => {
    const user = await userFromRequest(db, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await db.query<{ result: Result; updated_at: string }>(
      `SELECT result, updated_at FROM placement_sessions
        WHERE user_id = $1 AND status = 'done' ORDER BY updated_at DESC LIMIT 1`,
      [user.id],
    );
    return rows[0] ? { result: rows[0].result, at: rows[0].updated_at } : { result: null, at: null };
  });

  return app;
}
