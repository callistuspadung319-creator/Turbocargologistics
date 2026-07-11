import { getDatabase } from '@netlify/database';

/**
 * Return the marketplace database connection.
 *
 * Netlify's attached database is the production source of truth. Older
 * deployments may still expose DATABASE_URL, so synchronize the environment
 * names before calling the Netlify SDK using its supported no-argument form.
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

  process.env.NETLIFY_DB_URL = connectionString;
  process.env.DATABASE_URL = connectionString;

  return getDatabase();
}
