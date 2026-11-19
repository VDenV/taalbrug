import { loadConfig } from './config.js';
import { createMemoryDb, createPgDb, migrate } from './db.js';
import { consoleMailer } from './mailer.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = config.databaseUrl ? await createPgDb(config.databaseUrl) : await createMemoryDb();
if (!config.databaseUrl) console.warn('DATABASE_URL не задан: используется временная база в памяти (только для разработки).');
const applied = await migrate(db);
if (applied.length) console.log('Применены миграции:', applied.join(', '));

const app = buildApp({ config, db, mailer: consoleMailer });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`API на :${config.port}`);
