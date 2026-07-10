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
    console.error('Netlify Database readiness check failed:', error);
    return Response.json(
      { ok: false, database: 'netlify', schema: 'not-ready' },
      { status: 503 }
    );
  }
};

export const config: Config = { path: '/api/database-health' };
