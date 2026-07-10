import postgres from 'postgres';

let client;

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  if (!client) {
    client = postgres(connectionString, {
      ssl: 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false
    });
  }

  return { sql: client };
}
