//! The desktop shell.
//!
//! Deliberately thin: the editor is the web app, and the only thing Rust adds
//! is native file dialogs and real filesystem writes. Both arrive as plugins,
//! reached from TypeScript through `window.__TAURI__` — see
//! `src/platform/desktop/index.ts`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running ASCII Writer");
}
