-- `media.place_id` already exists as a plain INTEGER column from the
-- original schema (0001_init.sql, added ahead of this feature) — no FK
-- was attached there since `places` didn't exist yet, so this migration
-- only needs to create the table it points at.
CREATE TABLE places (
    id INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL,
    name TEXT NOT NULL, admin TEXT, country TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('geocoder','manual'))
);
