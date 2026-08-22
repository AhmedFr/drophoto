use dp_core::{DpError, DpResult};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{path::Path, str::FromStr};

pub struct SqliteCatalog {
    pub(crate) pool: SqlitePool,
}

impl SqliteCatalog {
    pub async fn open(path: &Path) -> DpResult<Self> {
        let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))
            .map_err(db)?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        Self::from_opts(opts).await
    }

    pub async fn open_in_memory() -> DpResult<Self> {
        Self::from_opts(
            SqliteConnectOptions::from_str("sqlite::memory:")
                .map_err(db)?
                .foreign_keys(true),
        )
        .await
    }

    async fn from_opts(opts: SqliteConnectOptions) -> DpResult<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
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
