// Курс: дерево модулей и уроков, которое редактирует конструктор.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

// status не задан = опубликован (так считает и фронтенд)
export interface Lesson extends Obj { id: string; type: string; status?: 'draft' | 'live' }
export interface Module extends Obj { id: string; lessons: Lesson[] }
export type Course = Module[];

const MAX_MODULES = 50;
const MAX_LESSONS = 100;
const MAX_ITEMS = 200;

function validLesson(l: unknown): l is Lesson {
  if (!isObj(l) || !isStr(l.id, 64) || !isStr(l.type, 32)) return false;
  if (l.status !== undefined && l.status !== 'draft' && l.status !== 'live') return false;
  if (l.items !== undefined) {
    if (!Array.isArray(l.items) || l.items.length > MAX_ITEMS) return false;
    if (!l.items.every((it) => isObj(it) && isStr(it.type, 32))) return false;
  }
  return true;
}

/** Проверяет форму курса. Возвращает курс или null. Содержимое упражнений не разбирается: оно свободное. */
export function validateCourse(input: unknown): Course | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MODULES) return null;
  const ids = new Set<string>();
  for (const m of input) {
    if (!isObj(m) || !isStr(m.id, 64) || !Array.isArray(m.lessons) || m.lessons.length > MAX_LESSONS) return null;
    if (!m.lessons.every(validLesson)) return null;
    for (const l of m.lessons as Lesson[]) {
      if (ids.has(l.id)) return null; // id уроков уникальны во всём курсе
      ids.add(l.id);
    }
  }
  return input as Course;
}

/** Для учеников: только опубликованные уроки. */
export function publishedOnly(course: Course): Course {
  return course.map((m) => ({ ...m, lessons: m.lessons.filter((l) => l.status !== 'draft') }));
}
