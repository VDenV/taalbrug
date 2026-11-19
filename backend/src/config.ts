export interface Config {
  port: number;
  baseUrl: string;
  databaseUrl: string | null; // null = встроенный PGlite (только dev/test)
  adminEmails: string[];
  teacherEmails: string[];
  cookieSecure: boolean;
  staticFile: string | null; // dev: отдавать index.html на /
}

const parseList = (v?: string) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.BASE_URL ?? 'http://localhost:3000';
  return {
    port: Number(env.PORT ?? 3000),
    baseUrl,
    databaseUrl: env.DATABASE_URL ?? null,
    adminEmails: parseList(env.ADMIN_EMAILS),
    teacherEmails: parseList(env.TEACHER_EMAILS),
    cookieSecure: baseUrl.startsWith('https://'),
    staticFile: env.STATIC_FILE ?? null,
  };
}
