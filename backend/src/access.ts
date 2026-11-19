// Доступ к курсу: модуль уровня A0 бесплатный, остальные требуют доступа к своему уровню.
// Явное поле модуля `access: 'free' | 'paid'` переопределяет правило по умолчанию.
import { createHash, randomInt } from 'node:crypto';
import type { Course, Module } from './course.js';

export const LEVELS = ['A0', 'A1', 'A2', 'B1'] as const;
export type Level = (typeof LEVELS)[number];
export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v);

export function isFreeModule(m: Module): boolean {
  if (m.access === 'free') return true;
  if (m.access === 'paid') return false;
  return m.lvl === 'A0';
}

const SHELL_KEYS = ['id', 'type', 'title', 'min', 'num', 'status'];

/** Для пользователя без доступа: у закрытых модулей остаются только названия уроков, без содержимого. */
export function gateCourse(course: Course, levels: ReadonlySet<string>): Course {
  return course.map((m) => {
    if (isFreeModule(m) || levels.has(String(m.lvl))) return m;
    const lessons = m.lessons.map((l) => Object.fromEntries(SHELL_KEYS.filter((k) => k in l).map((k) => [k, l[k]])));
    return { ...m, locked: true, lessons } as unknown as Module;
  });
}

export function lessonIsAccessible(course: Course, lessonId: string, levels: ReadonlySet<string>): boolean {
  const m = course.find((mod) => mod.lessons.some((l) => l.id === lessonId));
  return !m || isFreeModule(m) || levels.has(String(m.lvl));
}

// Коды доступа: 8 символов без похожих (0/O, 1/I), показываются как TB-XXXX-XXXX. В базе только хеш.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode(): { code: string; canonical: string } {
  let canonical = '';
  for (let i = 0; i < 8; i++) canonical += ALPHABET[randomInt(ALPHABET.length)];
  return { canonical, code: `TB-${canonical.slice(0, 4)}-${canonical.slice(4)}` };
}
export function canonicalCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let c = input.toUpperCase().replace(/[\s-]/g, '');
  if (c.startsWith('TB') && c.length === 10) c = c.slice(2);
  return /^[A-HJ-NP-Z2-9]{8}$/.test(c) ? c : null;
}
export const hashCode = (canonical: string) => createHash('sha256').update('code:' + canonical).digest('hex');
