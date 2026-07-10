-- Create the shipments table that backs the Turbocargologistics tracking app.
CREATE TABLE shipments (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'Processing',
  origin      TEXT NOT NULL,
  destination TEXT NOT NULL,
  weight      TEXT,
  progress    INTEGER NOT NULL DEFAULT 15,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
