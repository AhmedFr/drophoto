mod commands;
mod presence;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_env_filter("info").init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            commands::scan::start_scan,
            commands::scan::cancel_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
