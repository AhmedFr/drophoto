-- `media.place_id` already exists as a plain INTEGER column from the
-- original schema (0001_init.sql, added ahead of this feature) — no FK
-- was attached there since `places` didn't exist yet, so this migration
-- only needs to create the table it points at.
CREATE TABLE places (
    id INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL,
    name TEXT NOT NULL, admin TEXT, country TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('geocoder','manual'))
);

-- `IFNULL(admin, '')` rather than a plain `admin` column so two rows that
-- both have a NULL admin are still treated as the same identity by the
-- index (SQLite unique indexes treat NULL as distinct from every other
-- NULL, which would otherwise let concurrent upserts of the same
-- admin-less place create duplicate rows) — matches `upsert_place`'s own
-- `admin IS ?` dedupe comparison in `places.rs`.
CREATE UNIQUE INDEX places_identity ON places(name, IFNULL(admin, ''), country, source);
