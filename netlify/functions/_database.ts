import { getDatabase } from '@netlify/database';

/**
 * Return a database connection regardless of whether Netlify exposes the
 * attached database as NETLIFY_DB_URL or the site is configured with the
 * conventional DATABASE_URL variable.
 */
export function getMarketplaceDatabase() {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DB_URL ||
    process.env.NETLIFY_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'Database connection missing. Attach Netlify Database or set DATABASE_URL/NETLIFY_DB_URL for Functions.'
    );
  }

  // Older Netlify Database runtimes read DATABASE_URL while newer releases use
  // NETLIFY_DB_URL. Populate both before asking the SDK for a connection.
  process.env.DATABASE_URL ||= connectionString;
  process.env.NETLIFY_DB_URL ||= connectionString;

  return getDatabase({ connectionString } as any);
}
