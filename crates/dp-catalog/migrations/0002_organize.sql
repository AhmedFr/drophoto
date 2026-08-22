ALTER TABLE media ADD COLUMN organized_at TEXT;
CREATE INDEX media_drive_organized ON media(drive_id, organized_at);
CREATE TABLE organize_rules (drive_id INTEGER PRIMARY KEY REFERENCES drives(id) ON DELETE CASCADE, root TEXT NOT NULL, folder_tpl TEXT NOT NULL, file_tpl TEXT NOT NULL, keep_pairs INTEGER NOT NULL DEFAULT 1);
CREATE TABLE organize_jobs (id INTEGER PRIMARY KEY, drive_id INTEGER NOT NULL REFERENCES drives(id), status TEXT NOT NULL CHECK(status IN ('running','done','cancelled','failed')), planned INTEGER NOT NULL DEFAULT 0, moved INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE organize_items (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES organize_jobs(id) ON DELETE CASCADE, media_id INTEGER NOT NULL, old_rel_path TEXT NOT NULL, new_rel_path TEXT NOT NULL, status TEXT NOT NULL, error TEXT);
CREATE INDEX organize_items_job ON organize_items(job_id);
