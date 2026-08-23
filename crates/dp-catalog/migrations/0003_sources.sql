CREATE TABLE sources (id INTEGER PRIMARY KEY, drive_id INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE, rel_path TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(drive_id, rel_path));
ALTER TABLE media ADD COLUMN source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL;
CREATE INDEX media_source ON media(source_id);
