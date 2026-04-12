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
pub struct GeneralConfig {
    #[serde(rename = "enableDragging")]
    pub enable_dragging: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            enable_dragging: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub shortcuts: Shortcuts,
    #[serde(default)]
    pub general: GeneralConfig,
}

fn default_shortcuts() -> Shortcuts {
    #[cfg(target_os = "macos")]
    {
        Shortcuts {
            toggle_drawing: "Command+Shift+D".into(),
            clear_drawing: "Command+Shift+C".into(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Shortcuts {
            toggle_drawing: "Ctrl+Shift+D".into(),
            clear_drawing: "Ctrl+Shift+C".into(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcuts: default_shortcuts(),
            general: GeneralConfig::default(),
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

// ── Cursor / monitor helpers ──

/// Returns (x, y, width, height) of the monitor containing the cursor,
/// using native Windows APIs for reliable DPI-aware coordinate handling.
#[cfg(target_os = "windows")]
fn get_cursor_monitor_rect() -> Option<(i32, i32, u32, u32)> {
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct POINT {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct RECT {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MONITORINFO {
        cb_size: u32,
        rc_monitor: RECT,
        rc_work: RECT,
        dw_flags: u32,
    }

    const MONITOR_DEFAULTTONEAREST: u32 = 2;

    extern "system" {
        fn GetCursorPos(lp_point: *mut POINT) -> i32;
        fn MonitorFromPoint(pt: POINT, dw_flags: u32) -> isize;
        fn GetMonitorInfoW(h_monitor: isize, lpmi: *mut MONITORINFO) -> i32;
    }

    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) == 0 {
            return None;
        }

        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        if hmon == 0 {
            return None;
        }

        let mut info: MONITORINFO = std::mem::zeroed();
        info.cb_size = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut info) == 0 {
            return None;
        }

        let rc = &info.rc_monitor;
        Some((
            rc.left,
            rc.top,
            (rc.right - rc.left) as u32,
            (rc.bottom - rc.top) as u32,
        ))
    }
}

#[cfg(target_os = "macos")]
fn get_cursor_monitor_rect() -> Option<(i32, i32, u32, u32)> {
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    extern "C" {
        fn CGEventCreate(source: *const std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGEventGetLocation(event: *const std::ffi::c_void) -> CGPoint;
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    let (cx, cy) = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let pt = CGEventGetLocation(event);
        CFRelease(event);
        (pt.x as i32, pt.y as i32)
    };

    let monitor = xcap::Monitor::from_point(cx, cy).ok()?;
    let x = monitor.x().ok()?;
    let y = monitor.y().ok()?;
    let w = monitor.width().ok()?;
    let h = monitor.height().ok()?;
    Some((x, y, w, h))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_cursor_monitor_rect() -> Option<(i32, i32, u32, u32)> {
    None
}

// ── Window management ──

fn setup_overlay_size(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        if let Some((x, y, w, h)) = get_cursor_monitor_rect() {
            // Subtract 1 pixel from height to prevent Windows from treating it as a
            // fullscreen exclusive app, which causes the taskbar to lose its Mica/transparency effect.
            window
                .set_size(tauri::PhysicalSize::new(w, h.saturating_sub(1)))
                .ok();
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .ok();
        } else if let Some(monitor) = app.primary_monitor().ok().flatten() {
            let size = monitor.size();
            let pos = monitor.position();
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
        .title("MarkerOn 设置")
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
fn save_general(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    general: GeneralConfig,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.general = general.clone();
    save_config(&app, &cfg);
    app.emit("config-changed", cfg.clone()).ok();
    Ok(())
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
fn open_url(url: String) {
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

// ── Screen copy ──

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_screen() -> Result<(), String> {
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct POINT {
        x: i32,
        y: i32,
    }
    #[repr(C)]
    struct RECT {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[repr(C)]
    struct MONITORINFO {
        cb_size: u32,
        rc_monitor: RECT,
        rc_work: RECT,
        dw_flags: u32,
    }
    #[repr(C)]
    struct BITMAPINFOHEADER {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }
    #[repr(C)]
    struct BITMAPINFO {
        header: BITMAPINFOHEADER,
        _colors: [u32; 1],
    }

    const MONITOR_DEFAULTTONEAREST: u32 = 2;
    const SRCCOPY: u32 = 0x00CC0020;
    const CF_DIB: u32 = 8;
    const GMEM_MOVEABLE: u32 = 0x0002;

    extern "system" {
        fn GetCursorPos(p: *mut POINT) -> i32;
        fn MonitorFromPoint(pt: POINT, flags: u32) -> isize;
        fn GetMonitorInfoW(hmon: isize, lpmi: *mut MONITORINFO) -> i32;
        fn GetDC(hwnd: isize) -> isize;
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn CreateCompatibleBitmap(hdc: isize, w: i32, h: i32) -> isize;
        fn SelectObject(hdc: isize, h: isize) -> isize;
        fn BitBlt(
            dst: isize, x: i32, y: i32, w: i32, h: i32,
            src: isize, sx: i32, sy: i32, rop: u32,
        ) -> i32;
        fn GetDIBits(
            hdc: isize, hbm: isize, start: u32, lines: u32,
            bits: *mut u8, bmi: *mut BITMAPINFO, usage: u32,
        ) -> i32;
        fn DeleteObject(h: isize) -> i32;
        fn DeleteDC(hdc: isize) -> i32;
        fn ReleaseDC(hwnd: isize, hdc: isize) -> i32;
        fn OpenClipboard(hwnd: isize) -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, data: isize) -> isize;
        fn CloseClipboard() -> i32;
        fn GlobalAlloc(flags: u32, size: usize) -> isize;
        fn GlobalLock(hmem: isize) -> *mut u8;
        fn GlobalUnlock(hmem: isize) -> i32;
        fn GlobalFree(hmem: isize) -> isize;
    }

    unsafe {
        // 1. Locate the monitor under the cursor
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) == 0 {
            return Err("Failed to get cursor position".into());
        }
        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        if hmon == 0 {
            return Err("No monitor found".into());
        }
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cb_size = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut mi) == 0 {
            return Err("Failed to get monitor info".into());
        }
        let rc = &mi.rc_monitor;
        let w = rc.right - rc.left;
        let h = rc.bottom - rc.top;

        // 2. Capture screen via GDI BitBlt
        let hdc_screen = GetDC(0);
        if hdc_screen == 0 {
            return Err("Failed to get screen DC".into());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbm = CreateCompatibleBitmap(hdc_screen, w, h);
        let old_obj = SelectObject(hdc_mem, hbm);
        BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, rc.left, rc.top, SRCCOPY);

        // 3. Allocate clipboard buffer (BITMAPINFOHEADER + raw pixels)
        let header_size = std::mem::size_of::<BITMAPINFOHEADER>();
        let pixel_bytes = (w as usize) * (h as usize) * 4;
        let total = header_size + pixel_bytes;

        let hmem = GlobalAlloc(GMEM_MOVEABLE, total);
        if hmem == 0 {
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            return Err("GlobalAlloc failed".into());
        }
        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            GlobalFree(hmem);
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            return Err("GlobalLock failed".into());
        }

        // Prepare header for GetDIBits (positive height = bottom-up, standard CF_DIB)
        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.header.bi_size = header_size as u32;
        bmi.header.bi_width = w;
        bmi.header.bi_height = h;
        bmi.header.bi_planes = 1;
        bmi.header.bi_bit_count = 32;

        // Extract pixels directly into the global buffer (after header offset)
        GetDIBits(
            hdc_mem, hbm, 0, h as u32,
            ptr.add(header_size),
            &mut bmi,
            0,
        );

        // Copy the (potentially updated) header into the buffer
        std::ptr::copy_nonoverlapping(
            &bmi.header as *const _ as *const u8,
            ptr,
            header_size,
        );
        GlobalUnlock(hmem);

        // 4. Write raw bitmap to clipboard (no PNG encoding)
        if OpenClipboard(0) == 0 {
            GlobalFree(hmem);
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(0, hdc_screen);
            return Err("OpenClipboard failed".into());
        }
        EmptyClipboard();
        let result = SetClipboardData(CF_DIB, hmem);
        CloseClipboard();
        // System owns hmem on success; free only on failure
        if result == 0 {
            GlobalFree(hmem);
        }

        // 5. Cleanup GDI objects
        SelectObject(hdc_mem, old_obj);
        DeleteObject(hbm);
        DeleteDC(hdc_mem);
        ReleaseDC(0, hdc_screen);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn copy_screen() -> Result<(), String> {
    // Get cursor position via CoreGraphics
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    extern "C" {
        fn CGEventCreate(source: *const std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CGEventGetLocation(event: *const std::ffi::c_void) -> CGPoint;
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    let cursor_pos: Option<(i32, i32)> = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            None
        } else {
            let pt = CGEventGetLocation(event);
            CFRelease(event);
            Some((pt.x as i32, pt.y as i32))
        }
    };

    let monitor = cursor_pos
        .and_then(|(x, y)| xcap::Monitor::from_point(x, y).ok());
    let monitor = match monitor {
        Some(m) => m,
        None => xcap::Monitor::all()
            .map_err(|e| format!("{}", e))?
            .into_iter()
            .next()
            .ok_or_else(|| "No monitor found".to_string())?,
    };

    // Native screencapture: captures composite screen (incl. overlay) → clipboard, no PNG round-trip
    let x = monitor.x().map_err(|e| format!("{}", e))?;
    let y = monitor.y().map_err(|e| format!("{}", e))?;
    let w = monitor.width().map_err(|e| format!("{}", e))?;
    let h = monitor.height().map_err(|e| format!("{}", e))?;
    let region = format!("{},{},{},{}", x, y, w, h);
    let status = std::process::Command::new("screencapture")
        .args(["-c", "-x", "-R", &region])
        .status()
        .map_err(|e| format!("screencapture failed: {}", e))?;

    if !status.success() {
        return Err(format!(
            "screencapture exited with code {:?}",
            status.code()
        ));
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
#[tauri::command]
fn copy_screen() -> Result<(), String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("{}", e))?;
    let monitor = monitors.first().ok_or("No monitor found")?;
    let image = monitor.capture_image().map_err(|e| format!("{}", e))?;
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("{}", e))?;
    cb.set_image(arboard::ImageData {
        width: image.width() as usize,
        height: image.height() as usize,
        bytes: std::borrow::Cow::Owned(image.into_raw()),
    })
    .map_err(|e| format!("{}", e))?;
    Ok(())
}

// ── App ──

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
            get_config,
            save_shortcuts,
            save_general,
            exit_drawing,
            copy_screen,
            open_url,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Hide dock icon on macOS (menu bar / tray-only app)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
            let help_item =
                MenuItemBuilder::with_id("help", "使用帮助").build(app)?;
            let about_item =
                MenuItemBuilder::with_id("about", "关于").build(app)?;
            let quit_item =
                MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&settings_item)
                .item(&help_item)
                .item(&about_item)
                .separator()
                .item(&quit_item)
                .build()?;

            if let Some(tray) = app.tray_by_id("main") {
                tray.set_menu(Some(menu))?;
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
        .expect("error while running MarkerOn");
}
