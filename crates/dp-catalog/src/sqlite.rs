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
        Self::from_opts(opts, 4).await
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
