// Netlify Database migrations create and update the marketplace schema during deploy.
// Runtime functions must not execute DDL because the function database role may not
// have schema-management permissions. Keep this compatibility function so deployed
// API imports remain stable while all requests use the already-migrated tables.
export async function ensureMarketplaceSchema(): Promise<void> {
  return;
}
