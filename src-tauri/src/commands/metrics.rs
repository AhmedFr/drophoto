use crate::state::AppState;
use dp_core::{DpError, JobRunRow};
use tauri::State;

/// Max runs a single call returns, regardless of what the caller asks
/// for — the dashboard's "LAST RUNS" card only ever shows a handful, and
/// this keeps a stray large `limit` from pulling the whole `job_runs`
/// history into memory.
const JOB_RUNS_LIMIT_CAP: u32 = 50;

#[tauri::command]
pub async fn list_job_runs(state: State<'_, AppState>, limit: u32) -> Result<Vec<JobRunRow>, DpError> {
    state.catalog.list_job_runs(clamped_limit(limit)).await
}

/// Caps `limit` at [`JOB_RUNS_LIMIT_CAP`], leaving anything at or under
/// the cap (including 0) untouched.
///
/// Pure (no catalog, no `AppState`) so it can be unit-tested directly.
fn clamped_limit(limit: u32) -> u32 {
    limit.min(JOB_RUNS_LIMIT_CAP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_a_limit_under_the_cap_untouched() {
        assert_eq!(clamped_limit(20), 20);
    }

    #[test]
    fn leaves_a_limit_exactly_at_the_cap_untouched() {
        assert_eq!(clamped_limit(JOB_RUNS_LIMIT_CAP), JOB_RUNS_LIMIT_CAP);
    }

    #[test]
    fn clamps_a_limit_over_the_cap_down_to_the_cap() {
        assert_eq!(clamped_limit(JOB_RUNS_LIMIT_CAP + 1), JOB_RUNS_LIMIT_CAP);
        assert_eq!(clamped_limit(10_000), JOB_RUNS_LIMIT_CAP);
    }

    #[test]
    fn leaves_zero_untouched() {
        assert_eq!(clamped_limit(0), 0);
    }
}
