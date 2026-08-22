CREATE TABLE drives (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, volume_uuid TEXT, mount_path TEXT,
  role TEXT NOT NULL CHECK(role IN ('source','archive')), capacity INTEGER NOT NULL DEFAULT 0,
  free INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY, drive_id INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('photo','video')),
  ext TEXT NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER, taken_at TEXT,
  camera TEXT, lens TEXT, aperture REAL, shutter REAL, iso INTEGER, focal_mm REAL, lat REAL, lon REAL, place_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), missing_at TEXT,
  UNIQUE(drive_id, rel_path)
);
CREATE INDEX media_hash ON media(hash);
CREATE INDEX media_taken_at ON media(taken_at DESC);
CREATE TABLE scan_errors (id INTEGER PRIMARY KEY, drive_id INTEGER NOT NULL, path TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
