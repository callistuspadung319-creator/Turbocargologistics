import type { Config } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { ensureMarketplaceSchema } from './_ensure-schema';

export default async () => {
  try {
    await ensureMarketplaceSchema();
    const db = getDatabase();
    await db.sql`SELECT id FROM users LIMIT 1`;
    await db.sql`SELECT id FROM listings LIMIT 1`;
    return Response.json({ ok: true, database: 'netlify', schema: 'ready' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Netlify Database readiness check failed:', error);
    return Response.json(
      {
        ok: false,
        database: 'netlify',
        schema: 'not-ready',
        error: message,
        databaseUrlPresent: Boolean(process.env.DATABASE_URL)
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
};

export const config: Config = { path: '/api/database-health' };
