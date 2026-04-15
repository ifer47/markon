mod clipboard;
mod commands;
mod config;
mod i18n;
mod monitor;
mod shortcuts;

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconEvent,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

use config::{AppConfig, AppState};

pub fn rebuild_tray_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let s = i18n::strings();
    if let Some(tray) = app.tray_by_id("main") {
        let settings_item = MenuItemBuilder::with_id("settings", s.settings).build(app)?;
        let help_item = MenuItemBuilder::with_id("help", s.help).build(app)?;
        let about_item = MenuItemBuilder::with_id("about", s.about).build(app)?;
        let quit_item = MenuItemBuilder::with_id("quit", s.quit).build(app)?;
        let menu = MenuBuilder::new(app)
            .item(&settings_item)
            .item(&help_item)
            .item(&about_item)
            .separator()
            .item(&quit_item)
            .build()?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

fn setup_overlay_size(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        if let Some((x, y, w, h)) = monitor::get_cursor_monitor_rect() {
            // Subtract 1px from height to prevent Windows from treating it as
            // fullscreen exclusive, which causes the taskbar to lose Mica effect.
            window
                .set_size(tauri::PhysicalSize::new(w, h.saturating_sub(1)))
                .ok();
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .ok();
        } else if let Some(mon) = app.primary_monitor().ok().flatten() {
            let size = mon.size();
            let pos = mon.position();
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
    open_settings_tab(app, None);
}

fn open_settings_tab(app: &AppHandle, tab: Option<&str>) {
    if let Some(win) = app.get_webview_window("settings") {
        win.set_focus().ok();
        if let Some(t) = tab {
            app.emit("switch-tab", t).ok();
        }
        return;
    }

    let hash = match tab {
        Some(t) => format!("index.html#settings/{}", t),
        None => "index.html#settings".to_string(),
    };
    let url = WebviewUrl::App(hash.into());
    let builder = WebviewWindowBuilder::new(app, "settings", url)
        .title(i18n::strings().window_title)
        .inner_size(620.0, 450.0)
        .min_inner_size(500.0, 380.0)
        .resizable(true)
        .visible(true);

    builder.build().ok();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("settings") {
                win.set_focus().ok();
            }
        }))
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
            commands::get_config,
            commands::save_shortcuts,
            commands::save_general,
            commands::save_locale,
            commands::exit_drawing,
            commands::open_url,
            clipboard::copy_screen,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let loaded = config::load_config(&handle);
            i18n::init(loaded.general.locale.as_deref());
            {
                let state = handle.state::<AppState>();
                let mut cfg = state.config.lock().unwrap();
                *cfg = loaded;
            }

            setup_overlay_size(&handle);

            rebuild_tray_menu(&handle).ok();

            if let Some(tray) = app.tray_by_id("main") {
                tray.on_menu_event(move |app, event| match event.id().as_ref() {
                    "settings" => open_settings(app),
                    "help" => open_settings_tab(app, Some("help")),
                    "about" => open_settings_tab(app, Some("about")),
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

            shortcuts::register_shortcuts(&handle);

            let ctrlc_handle = handle.clone();
            ctrlc::set_handler(move || {
                ctrlc_handle.exit(0);
            })
            .ok();

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
        .expect("error while running MarkerOn");
}
