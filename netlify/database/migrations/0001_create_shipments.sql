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

-- Seed a few demo shipments so the site is populated on first load.
INSERT INTO shipments (id, status, origin, destination, weight, progress, created_at) VALUES
  ('TCL001234', 'In Transit', 'New York, NY',  'Los Angeles, CA', '12 lbs', 65,  NOW() - INTERVAL '2 hours'),
  ('TCL001235', 'Delivered',  'Chicago, IL',   'Miami, FL',       '5 lbs',  100, NOW() - INTERVAL '1 day'),
  ('TCL001236', 'Processing', 'Boston, MA',    'Seattle, WA',     '8 lbs',  15,  NOW());
