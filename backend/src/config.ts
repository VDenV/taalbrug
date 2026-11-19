export interface Config {
  port: number;
  baseUrl: string;
  databaseUrl: string | null; // null = встроенный PGlite (только dev/test)
  adminEmails: string[];
  cookieSecure: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.BASE_URL ?? 'http://localhost:3000';
  return {
    port: Number(env.PORT ?? 3000),
    baseUrl,
    databaseUrl: env.DATABASE_URL ?? null,
    adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    cookieSecure: baseUrl.startsWith('https://'),
  };
}
