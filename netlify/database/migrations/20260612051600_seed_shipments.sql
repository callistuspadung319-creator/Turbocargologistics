-- Seed a few demo shipments so the site is populated on first load.
INSERT INTO shipments (id, status, origin, destination, weight, progress, created_at) VALUES
  ('TCL001234', 'In Transit', 'New York, NY',  'Los Angeles, CA', '12 lbs', 65,  NOW() - INTERVAL '2 hours'),
  ('TCL001235', 'Delivered',  'Chicago, IL',   'Miami, FL',       '5 lbs',  100, NOW() - INTERVAL '1 day'),
  ('TCL001236', 'Processing', 'Boston, MA',    'Seattle, WA',     '8 lbs',  15,  NOW());
