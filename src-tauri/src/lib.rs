mod commands;
mod presence;
mod state;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let st = tauri::async_runtime::block_on(state::AppState::init(app.handle()))?;
            app.manage(st);
            presence::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::volumes::list_volumes,
            commands::drives::register_drive,
            commands::drives::list_drives,
            commands::drives::forget_drive,
            commands::drives::relink_drive,
            commands::drives::count_drive_media,
            commands::media::query_media,
            commands::media::count_media,
            commands::media::get_media,
            commands::scan::start_scan,
            commands::scan::cancel_job,
            commands::scan::count_scan_errors,
            commands::scan::list_scan_errors,
            commands::search::search_media,
            commands::search::rebuild_fts,
            commands::sidecars::start_sidecar_sync_all,
            commands::sources::detect_sources,
            commands::sources::list_sources,
            commands::sources::save_sources,
            commands::sources::set_source_enabled,
            commands::tags::list_tags,
            commands::tags::tags_for_media,
            commands::tags::tag_media,
            commands::organize::get_rule,
            commands::organize::save_rule,
            commands::organize::list_unorganized_summaries,
            commands::organize::plan_organize,
            commands::organize::start_organize,
            commands::organize::list_jobs,
            commands::organize::list_job_items,
            commands::organize::revert_organize,
            commands::places::start_geocode,
            commands::places::list_place_counts,
            commands::places::search_cities,
            commands::places::set_media_place,
            commands::metrics::list_job_runs,
            commands::settings::get_settings,
            commands::settings::set_preview_quality,
            commands::settings::storage_usage,
            commands::settings::tool_health,
            commands::settings::start_regen_previews,
            commands::settings::reset_app_data,
            commands::settings::uninstall_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
