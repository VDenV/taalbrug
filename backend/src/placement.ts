// Адаптивный тест уровня: «лестница». Верно → сложнее, неверно → легче.
import { randomInt } from 'node:crypto';
import { BANK, type Question } from './placement-bank.js';

export const START_LEVEL = 2;
export const MIN_QUESTIONS = 8; // раньше этого число не останавливаемся (кроме крайних случаев)
export const MAX_QUESTIONS = 14;
const STABLE_WINDOW = 4; // последние N вопросов в диапазоне ≤ 1 уровня = оценка устоялась
const TOP = 5;

export type Rng = (n: number) => number; // случайное целое в [0, n)
export const cryptoRng: Rng = (n) => randomInt(n);

export interface Asked { id: string; d: number; ok: boolean }
export interface State {
  d: number; // сложность следующего вопроса
  asked: Asked[];
  current: { id: string; order: number[] } | null; // order[i] = индекс исходного варианта на позиции i
}
export interface Result { level: 'A0' | 'A1' | 'A2'; theta: number; correct: number; total: number }
export interface PublicQuestion {
  id: string; type: Question['type']; prompt: Question['prompt']; say?: string; options: string[];
}

const byId = new Map(BANK.map((q) => [q.id, q]));
export const questionById = (id: string) => byId.get(id);

export function initState(rng: Rng): State {
  const s: State = { d: START_LEVEL, asked: [], current: null };
  s.current = pick(s, rng);
  return s;
}

/** Выбирает не заданный ещё вопрос нужной сложности, иначе ближайшей по сложности. */
function pick(s: State, rng: Rng): State['current'] {
  const used = new Set(s.asked.map((a) => a.id));
  const free = BANK.filter((q) => !used.has(q.id));
  if (!free.length) return null;
  const dist = (q: Question) => Math.abs(q.level - s.d);
  const best = Math.min(...free.map(dist));
  const pool = free.filter((q) => dist(q) === best);
  const q = pool[rng(pool.length)];
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { id: q.id, order };
}

export function present(s: State): PublicQuestion | null {
  if (!s.current) return null;
  const q = byId.get(s.current.id)!;
  const out: PublicQuestion = { id: q.id, type: q.type, prompt: q.prompt, options: s.current.order.map((i) => q.options[i]) };
  if (q.say) out.say = q.say;
  return out;
}

function isDone(s: State): boolean {
  const n = s.asked.length;
  if (!s.current || n >= MAX_QUESTIONS) return true;
  const last3 = s.asked.slice(-3);
  // Крайние случаи: три подряд ошибки на самом лёгком уровне или три верных на самом сложном.
  if (last3.length === 3 && last3.every((a) => a.d === 0 && !a.ok)) return true;
  if (last3.length === 3 && last3.every((a) => a.d === TOP && a.ok)) return true;
  if (n < MIN_QUESTIONS) return false;
  const w = s.asked.slice(-STABLE_WINDOW).map((a) => a.d);
  return Math.max(...w) - Math.min(...w) <= 1;
}

export function estimate(s: State): Result {
  // Среднее по последним 6 вопросам. Ученик, который проходит уровень k и проваливает k+1, колеблется между ними,
  // и среднее равно k + 0.5. Поэтому уровень A1 засчитывается с 2.0 (справляется с вопросами уровня 2),
  // а A2 с 4.0 (справляется с вопросами уровня 4).
  const window = s.asked.slice(-6).map((a) => a.d);
  const theta = window.reduce((a, b) => a + b, 0) / window.length;
  const level = theta < 2 ? 'A0' : theta < 4 ? 'A1' : 'A2';
  return { level, theta: Math.round(theta * 100) / 100, correct: s.asked.filter((a) => a.ok).length, total: s.asked.length };
}

/** Принимает ответ (индекс показанного варианта или null = «не знаю»). Меняет состояние. */
export function answer(s: State, choice: number | null, rng: Rng): { done: false; question: PublicQuestion } | { done: true; result: Result } {
  if (!s.current) throw new Error('no current question');
  const q = byId.get(s.current.id)!;
  const ok = choice !== null && s.current.order[choice] === q.answer;
  s.asked.push({ id: q.id, d: q.level, ok });
  s.d = ok ? Math.min(TOP, q.level + 1) : Math.max(0, q.level - 1);
  s.current = null;
  if (s.asked.length < MAX_QUESTIONS) s.current = pick(s, rng);
  if (isDone(s)) {
    s.current = null;
    return { done: true, result: estimate(s) };
  }
  return { done: false, question: present(s)! };
}
