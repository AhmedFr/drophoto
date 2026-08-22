use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize, Clone)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum DpError {
    #[error("{message}")]
    Io { message: String, path: Option<String> },
    #[error("{message}")]
    NotFound { message: String },
    #[error("{tool}: {message}")]
    Sidecar { tool: String, message: String },
    #[error("{message}")]
    Db { message: String },
    #[error("{message}")]
    Unsupported { message: String, path: Option<String> },
}

pub type DpResult<T> = Result<T, DpError>;

impl DpError {
    pub fn io(e: &std::io::Error, path: impl Into<Option<String>>) -> Self {
        Self::Io {
            message: e.to_string(),
            path: path.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_code_tag() {
        let e = DpError::NotFound { message: "x".into() };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"code":"not_found","message":"x"}"#
        );
    }
}
