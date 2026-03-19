use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconEvent,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

// ── Config ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shortcuts {
    #[serde(rename = "toggleDrawing")]
    pub toggle_drawing: String,
    #[serde(rename = "clearDrawing")]
    pub clear_drawing: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub shortcuts: Shortcuts,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcuts: Shortcuts {
                toggle_drawing: "Ctrl+Shift+D".into(),
                clear_drawing: "Ctrl+Shift+C".into(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<Vec<String>>,
}

struct AppState {
    config: Mutex<AppConfig>,
    is_drawing: Mutex<bool>,
}

fn config_path(app: &AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_config_dir().expect("failed to get config dir");
    fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

fn load_config(app: &AppHandle) -> AppConfig {
    let path = config_path(app);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

fn save_config(app: &AppHandle, config: &AppConfig) {
    let path = config_path(app);
    if let Ok(json) = serde_json::to_string_pretty(config) {
        fs::write(path, json).ok();
    }
}

// ── Window management ──

fn setup_overlay_size(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        if let Some(monitor) = app.primary_monitor().ok().flatten() {
            let size = monitor.size();
            let pos = monitor.position();
            // Subtract 1 pixel from height to prevent Windows from treating it as a
            // fullscreen exclusive app, which causes the taskbar to lose its Mica/transparency effect.
            window
                .set_size(tauri::PhysicalSize::new(size.width, size.height.saturating_sub(1)))
                .ok();
            window
                .set_position(tauri::PhysicalPosition::new(pos.x, pos.y))
                .ok();
        }
        window.set_ignore_cursor_events(true).ok();
    }
}

fn toggle_drawing(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut is_drawing = state.is_drawing.lock().unwrap();
    *is_drawing = !*is_drawing;
    let active = *is_drawing;
    drop(is_drawing);

    if let Some(window) = app.get_webview_window("overlay") {
        if active {
            setup_overlay_size(app);
            app.emit("clear-drawing", ()).ok();
            window.show().ok();
            window.set_ignore_cursor_events(false).ok();
            window.set_always_on_top(true).ok();
            window.set_focus().ok();
            app.emit("toggle-drawing", true).ok();
        } else {
            window.set_ignore_cursor_events(true).ok();
            app.emit("toggle-drawing", false).ok();
            window.hide().ok();
        }
    }
}

fn clear_drawing(app: &AppHandle) {
    app.emit("clear-drawing", ()).ok();
}

fn open_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        win.set_focus().ok();
        return;
    }

    let url = WebviewUrl::App("index.html#settings".into());
    let builder = WebviewWindowBuilder::new(app, "settings", url)
        .title("MarkOn 设置")
        .inner_size(600.0, 450.0)
        .min_inner_size(500.0, 380.0)
        .resizable(true)
        .visible(true);

    builder.build().ok();
}

// ── Shortcuts ──

fn parse_shortcut(accel: &str) -> Option<Shortcut> {
    accel.parse::<Shortcut>().ok()
}

fn register_shortcuts(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = state.config.lock().unwrap().clone();

    app.global_shortcut().unregister_all().ok();

    let app_handle = app.clone();
    if let Some(shortcut) = parse_shortcut(&config.shortcuts.toggle_drawing) {
        let h = app_handle.clone();
        app.global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    toggle_drawing(&h);
                }
            })
            .ok();
    }

    if let Some(shortcut) = parse_shortcut(&config.shortcuts.clear_drawing) {
        let h = app_handle.clone();
        app.global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    clear_drawing(&h);
                }
            })
            .ok();
    }
}

// ── IPC Commands ──

#[tauri::command]
fn get_config(state: tauri::State<'_, AppState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    shortcuts: Shortcuts,
) -> SaveResult {
    let old_config = state.config.lock().unwrap().clone();
    let mut failed = Vec::new();

    app.global_shortcut().unregister_all().ok();

    let actions: Vec<(&str, &str)> = vec![
        ("开始标注", &shortcuts.toggle_drawing),
        ("清除标注", &shortcuts.clear_drawing),
    ];

    for (label, accel) in &actions {
        if parse_shortcut(accel).is_none() {
            failed.push(format!("{}: {}", label, accel));
        }
    }

    if !failed.is_empty() {
        // Rollback: re-register old shortcuts
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

    // Test registration
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

    // Success: save new config and re-register with handlers
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.shortcuts = shortcuts;
        save_config(&app, &cfg);
    }
    register_shortcuts(&app);

    SaveResult {
        ok: true,
        failed: None,
    }
}

#[tauri::command]
fn exit_drawing(app: AppHandle, state: tauri::State<'_, AppState>) {
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
fn set_ignore_mouse(app: AppHandle, ignore: bool) {
    if let Some(window) = app.get_webview_window("overlay") {
        window.set_ignore_cursor_events(ignore).ok();
    }
}

// ── App ──

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            config: Mutex::new(AppConfig::default()),
            is_drawing: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_shortcuts,
            exit_drawing,
            set_ignore_mouse,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Load config
            let config = load_config(&handle);
            {
                let state = handle.state::<AppState>();
                let mut cfg = state.config.lock().unwrap();
                *cfg = config;
            }

            // Setup overlay window
            setup_overlay_size(&handle);

            // Setup tray
            let settings_item =
                MenuItemBuilder::with_id("settings", "设置").build(app)?;
            let quit_item =
                MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&settings_item)
                .separator()
                .item(&quit_item)
                .build()?;

            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(menu))?;
                tray.on_menu_event(move |app, event| match event.id().as_ref() {
                    "settings" => open_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
                let handle_click = handle.clone();
                tray.on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_drawing(&handle_click);
                    }
                });
            }

            // Register shortcuts
            register_shortcuts(&handle);

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "overlay" {
                    api.prevent_close();
                    window.hide().ok();
                }
            }
            tauri::WindowEvent::Focused(false) => {
                if window.label() == "overlay" {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    let mut is_drawing = state.is_drawing.lock().unwrap();
                    if *is_drawing {
                        *is_drawing = false;
                        drop(is_drawing);
                        window.set_ignore_cursor_events(true).ok();
                        app.emit("toggle-drawing", false).ok();
                        window.hide().ok();
                    }
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running MarkOn");
}
