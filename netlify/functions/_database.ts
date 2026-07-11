import { getDatabase } from '@netlify/database';

/**
 * Return the marketplace database connection.
 *
 * Netlify's attached database is the source of truth for production. A legacy
 * DATABASE_URL may still exist from an older deployment, so it must not win
 * over NETLIFY_DB_URL or NETLIFY_DATABASE_URL.
 */
export function getMarketplaceDatabase() {
  const connectionString =
    process.env.NETLIFY_DB_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'Database connection missing. Attach Netlify Database or set NETLIFY_DB_URL/DATABASE_URL for Functions.'
    );
  }

  // Keep both names synchronized for packages that read one specific key.
  process.env.NETLIFY_DB_URL = connectionString;
  process.env.DATABASE_URL = connectionString;

  return getDatabase({ connectionString } as any);
}
