use dp_core::{DpError, DpResult};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{path::Path, str::FromStr, time::Duration};

pub struct SqliteCatalog {
    pub(crate) pool: SqlitePool,
}

impl SqliteCatalog {
    pub async fn open(path: &Path) -> DpResult<Self> {
        let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .map_err(db)?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        // A file-backed DB can serve multiple concurrent readers/writers;
        // WAL + a small pool avoids `database is locked` under load.
        let catalog = Self::from_opts(opts, 4).await?;

        // Startup reconciliation, for the file-backed DB only (an
        // in-memory one never outlives its process, so it can't have
        // inherited anything): an `organize_jobs` row left `"running"`
        // belongs to a previous process that died mid-run, and no job
        // will ever come back to finish it.
        let reconciled = crate::organize_jobs::fail_running_organize_jobs(&catalog.pool).await?;
        if reconciled > 0 {
            tracing::warn!(
                count = reconciled,
                "marked organize jobs left running by a previous process as failed"
            );
        }

        // `media_fts` is derived data (see `fts` module docs) — if a
        // previous process crashed mid-rebuild, was upgraded from before
        // migration 0006 without a backfill, or otherwise left the index
        // empty while `media` has rows, no future write will ever notice
        // and repair it on its own (writes only ever sync the one row
        // they touch). Catch that here, once, at startup.
        let has_media: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media)")
            .fetch_one(&catalog.pool)
            .await
            .map_err(db)?;
        let has_fts: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media_fts)")
            .fetch_one(&catalog.pool)
            .await
            .map_err(db)?;
        if has_media && !has_fts {
            tracing::info!("media_fts is empty but media has rows; backfilling the search index");
            crate::fts::rebuild_fts(&catalog.pool).await?;
        }

        Ok(catalog)
    }

    pub async fn open_in_memory() -> DpResult<Self> {
        // sqlite::memory: is a private DB per connection, so the pool must be
        // capped at 1 or separate connections would see separate databases.
        Self::from_opts(
            SqliteConnectOptions::from_str("sqlite::memory:")
                .map_err(db)?
                .foreign_keys(true),
            1,
        )
        .await
    }

    async fn from_opts(opts: SqliteConnectOptions, max_connections: u32) -> DpResult<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(opts)
            .await
            .map_err(db)?;
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|e| DpError::Db {
                message: e.to_string(),
            })?;
        Ok(Self { pool })
    }
}

pub(crate) fn db(e: impl std::fmt::Display) -> DpError {
    DpError::Db {
        message: e.to_string(),
    }
}
