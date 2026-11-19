import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createMemoryDb, migrate, type Db } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { BANK } from '../src/placement-bank.js';
import { MAX_QUESTIONS, MIN_QUESTIONS, answer, initState, present, type Rng, type State } from '../src/placement.js';

const first: Rng = () => 0; // детерминированно: всегда первый кандидат
const byId = new Map(BANK.map((q) => [q.id, q]));

/** Проходит тест целиком. skill(level) решает, ответит ли «ученик» верно на вопрос этой сложности. */
function run(skill: (level: number) => boolean) {
  const s: State = initState(first);
  const levels: number[] = [];
  for (let i = 0; i < 30; i++) {
    const q = present(s)!;
    const bank = byId.get(q.id)!;
    levels.push(bank.level);
    const correct = q.options.indexOf(bank.options[bank.answer]);
    const wrongIdx = q.options.findIndex((_, k) => k !== correct);
    const out = answer(s, skill(bank.level) ? correct : wrongIdx, first);
    if (out.done) return { result: out.result, levels };
  }
  throw new Error('test did not finish');
}

describe('bank', () => {
  it('has unique ids, valid answers and enough questions per level', () => {
    expect(new Set(BANK.map((q) => q.id)).size).toBe(BANK.length);
    for (const q of BANK) {
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options.length);
      expect(new Set(q.options).size).toBe(q.options.length);
      if (q.type === 'listen') expect(q.say).toBeTruthy();
    }
    for (let l = 0; l <= 5; l++) expect(BANK.filter((q) => q.level === l).length).toBeGreaterThanOrEqual(5);
  });
});

describe('adaptive engine', () => {
  it('starts in the middle', () => {
    expect(byId.get(present(initState(first))!.id)!.level).toBe(2);
  });

  it('goes up when answers are correct and finishes at A2', () => {
    const { result, levels } = run(() => true);
    expect(levels.slice(0, 4)).toEqual([2, 3, 4, 5]);
    expect(result.level).toBe('A2');
    expect(result.correct).toBe(result.total);
  });

  it('goes down when answers are wrong and finishes at A0 early', () => {
    const { result, levels } = run(() => false);
    expect(levels.slice(0, 3)).toEqual([2, 1, 0]);
    expect(result.level).toBe('A0');
    expect(result.total).toBeLessThan(MIN_QUESTIONS); // три ошибки подряд на самом лёгком уровне: не мучаем ученика
  });

  it('places a learner who knows A1 but not A2 at A1', () => {
    const { result } = run((l) => l <= 3);
    expect(result.level).toBe('A1');
  });

  it('places a learner who knows only the first words at A0', () => {
    expect(run((l) => l <= 1).result.level).toBe('A0');
  });

  it('never repeats a question and never exceeds the maximum', () => {
    const s = initState(first);
    const seen = new Set<string>();
    let n = 0;
    for (;;) {
      const q = present(s)!;
      expect(seen.has(q.id)).toBe(false);
      seen.add(q.id);
      n++;
      if (answer(s, n % 2, first).done) break;
    }
    expect(n).toBeLessThanOrEqual(MAX_QUESTIONS);
  });

  it('treats "don\'t know" as a wrong answer', () => {
    const s = initState(first);
    answer(s, null, first);
    expect(s.asked[0].ok).toBe(false);
    expect(s.d).toBe(1);
  });

  it('shuffles options but keeps the right answer identifiable', () => {
    const rng: Rng = (n) => n - 1; // максимально «перемешивающий» генератор
    const s = initState(rng);
    const q = present(s)!;
    const bank = byId.get(q.id)!;
    expect([...q.options].sort()).toEqual([...bank.options].sort());
    const correct = q.options.indexOf(bank.options[bank.answer]);
    answer(s, correct, rng);
    expect(s.asked[0].ok).toBe(true);
  });
});

describe('placement API', () => {
  let app: FastifyInstance;
  let db: Db;
  let links: string[];
  beforeEach(async () => {
    db = await createMemoryDb();
    await migrate(db);
    links = [];
    app = buildApp({ config: loadConfig({}), db, mailer: { sendLoginLink: async (_t, l) => void links.push(l) } });
  });
  afterEach(async () => {
    await app.close();
    await db.close();
  });
  const post = (url: string, payload: object, cookies?: Record<string, string>) => app.inject({ method: 'POST', url, payload, cookies });

  async function playAll(token: string, first: { n: number; question: { id: string; options: string[] } }, correct = true) {
    let cur: { n: number; question: { id: string; options: string[] } } = first;
    for (let i = 0; i < 30; i++) {
      const bank = byId.get(cur.question.id)!;
      const right = cur.question.options.indexOf(bank.options[bank.answer]);
      const choice = correct ? right : null;
      const res = (await post('/api/placement/answer', { token, n: cur.n, choice })).json();
      if (res.done) return res.result;
      cur = res;
    }
    throw new Error('did not finish');
  }

  it('hides correct answers and runs a full test anonymously', async () => {
    const s = (await post('/api/placement/start', {})).json();
    expect(s.n).toBe(1);
    expect(s.question).not.toHaveProperty('answer');
    expect(JSON.stringify(s)).not.toMatch(/"answer"/);
    const result = await playAll(s.token, s);
    expect(result.level).toBe('A2');
  });

  it('can resume an active test and returns the result when done', async () => {
    const s = (await post('/api/placement/start', {})).json();
    const r1 = (await post('/api/placement/resume', { token: s.token })).json();
    expect(r1.question.id).toBe(s.question.id);
    expect(r1.n).toBe(1);
    const result = await playAll(s.token, s, false);
    expect(result.level).toBe('A0');
    expect((await post('/api/placement/resume', { token: s.token })).json()).toEqual({ done: true, result });
  });

  it('rejects out-of-sync, invalid and unknown requests', async () => {
    const s = (await post('/api/placement/start', {})).json();
    expect((await post('/api/placement/answer', { token: s.token, n: 5, choice: 0 })).statusCode).toBe(409);
    expect((await post('/api/placement/answer', { token: s.token, n: 1, choice: 9 })).statusCode).toBe(400);
    expect((await post('/api/placement/answer', { token: s.token, n: 1, choice: 'a' })).statusCode).toBe(400);
    expect((await post('/api/placement/answer', { token: 'nope', n: 1, choice: 0 })).statusCode).toBe(404);
    expect((await post('/api/placement/resume', { token: 'nope' })).statusCode).toBe(404);
  });

  it('does not accept answers after the test is done', async () => {
    const s = (await post('/api/placement/start', {})).json();
    await playAll(s.token, s, false);
    expect((await post('/api/placement/answer', { token: s.token, n: 1, choice: 0 })).statusCode).toBe(409);
  });

  it('claims a finished test for a logged-in user', async () => {
    const s = (await post('/api/placement/start', {})).json();
    expect((await post('/api/placement/claim', { token: s.token })).statusCode).toBe(401);

    await post('/api/auth/request', { email: 'a@example.com' });
    const sid = (await post('/api/auth/verify', { token: new URL(links[0]).searchParams.get('login')! })).cookies[0].value;
    const cookies = { tb_session: sid };
    expect((await post('/api/placement/claim', { token: s.token }, cookies)).statusCode).toBe(404); // ещё не завершён

    const result = await playAll(s.token, s);
    expect((await post('/api/placement/claim', { token: s.token }, cookies)).json().result).toEqual(result);
    const me = (await app.inject({ method: 'GET', url: '/api/me/placement', cookies })).json();
    expect(me.result).toEqual(result);
    expect((await app.inject({ method: 'GET', url: '/api/me/placement' })).statusCode).toBe(401);
  });
});
