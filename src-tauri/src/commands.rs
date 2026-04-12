use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::config::{AppConfig, AppState, GeneralConfig, SaveResult, Shortcuts};
use crate::shortcuts::{parse_shortcut, register_shortcuts};

#[tauri::command]
pub fn get_config(state: tauri::State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    shortcuts: Shortcuts,
) -> SaveResult {
    let old_config = state.config.lock().unwrap().clone();
    let mut failed = Vec::new();

    app.global_shortcut().unregister_all().ok();

    let s = crate::i18n::strings();
    let actions: Vec<(&str, &str)> = vec![
        (s.toggle_drawing, &shortcuts.toggle_drawing),
        (s.clear_drawing, &shortcuts.clear_drawing),
    ];

    for (label, accel) in &actions {
        if parse_shortcut(accel).is_none() {
            failed.push(format!("{}: {}", label, accel));
        }
    }

    if !failed.is_empty() {
        {
            let mut cfg = state.config.lock().unwrap();
            *cfg = old_config;
        }
        register_shortcuts(&app);
        return SaveResult {
            ok: false,
            failed: Some(failed),
        };
    }

    for (label, accel) in &actions {
        if let Some(shortcut) = parse_shortcut(accel) {
            if app.global_shortcut().register(shortcut).is_err() {
                failed.push(format!("{}: {}", label, accel));
            }
        }
    }

    if !failed.is_empty() {
        {
            let mut cfg = state.config.lock().unwrap();
            *cfg = old_config;
        }
        register_shortcuts(&app);
        return SaveResult {
            ok: false,
            failed: Some(failed),
        };
    }

    {
        let mut cfg = state.config.lock().unwrap();
        cfg.shortcuts = shortcuts;
        crate::config::save_config(&app, &cfg);
    }
    register_shortcuts(&app);

    SaveResult {
        ok: true,
        failed: None,
    }
}

#[tauri::command]
pub fn save_general(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    general: GeneralConfig,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.general = general.clone();
    crate::config::save_config(&app, &cfg);
    app.emit("config-changed", cfg.clone()).ok();
    Ok(())
}

#[tauri::command]
pub fn exit_drawing(app: AppHandle, state: tauri::State<'_, AppState>) {
    let mut is_drawing = state.is_drawing.lock().unwrap();
    if *is_drawing {
        *is_drawing = false;
        drop(is_drawing);
        if let Some(window) = app.get_webview_window("overlay") {
            window.set_ignore_cursor_events(true).ok();
            app.emit("toggle-drawing", false).ok();
            window.hide().ok();
        }
    }
}

#[tauri::command]
pub fn open_url(url: String) {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .ok();
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn().ok();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().ok();
    }
}
