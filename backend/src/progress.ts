// Прогресс ученика: белый список полей и проверка форм данных.
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const VALIDATORS: Record<string, (v: unknown) => boolean> = {
  done: isObj,
  scores: isObj,
  known: isObj,
  fc: isObj,
  ex: isObj,
  cur: (v) => typeof v === 'string' && v.length <= 64,
  week: (v) => Array.isArray(v) && v.length === 7 && v.every((n) => typeof n === 'number' && Number.isFinite(n)),
  streak: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000,
};

export const PROGRESS_KEYS = Object.keys(VALIDATORS);

/** Возвращает очищенные данные или null, если форма неверна. Лишние поля отбрасываются. */
export function sanitizeProgress(input: unknown): Record<string, unknown> | null {
  if (!isObj(input)) return null;
  const out: Record<string, unknown> = {};
  for (const key of PROGRESS_KEYS) {
    if (!(key in input)) continue;
    if (!VALIDATORS[key](input[key])) return null;
    out[key] = input[key];
  }
  return out;
}
