-- Historical Netlify Database seed migration restored because it is already
-- recorded as applied in production. Keep this file and migration name intact.
INSERT INTO shipments (id, status, origin, destination, weight, progress)
VALUES
  ('TCG-2026-987654', 'In Transit', 'Los Angeles, CA', 'New York, NY', '24 kg', 65),
  ('TCG-2026-654321', 'Processing', 'Houston, TX', 'Miami, FL', '12 kg', 15),
  ('TCG-2026-456789', 'Delivered', 'Chicago, IL', 'Seattle, WA', '18 kg', 100)
ON CONFLICT (id) DO NOTHING;
