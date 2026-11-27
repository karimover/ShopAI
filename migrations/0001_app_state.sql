CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_state (id, payload, revision)
VALUES (
  'shopai',
  '{"users":[],"sessions":[],"stores":[],"products":[],"orders":[]}',
  0
);
