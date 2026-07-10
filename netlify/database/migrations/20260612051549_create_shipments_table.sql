-- Historical Netlify Database migration restored because it is already
-- recorded as applied in production. Do not rename or delete this file.
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'Processing',
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  weight TEXT,
  progress INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
