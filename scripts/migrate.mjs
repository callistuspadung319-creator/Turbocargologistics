import fs from 'node:fs/promises';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for marketplace migrations');
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 1,
  prepare: false
});

try {
  const migration = await fs.readFile(new URL('../db/001_marketplace.sql', import.meta.url), 'utf8');
  await sql.unsafe(migration);
  console.log('Marketplace schema is ready.');
} finally {
  await sql.end({ timeout: 5 });
}
