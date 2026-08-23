ALTER TABLE organize_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'organize';
ALTER TABLE organize_jobs ADD COLUMN reverts_job_id INTEGER REFERENCES organize_jobs(id);
