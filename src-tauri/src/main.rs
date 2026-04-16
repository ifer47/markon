#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force X11 backend via XWayland on Wayland sessions.
    // This must be set before any threads are spawned (before Tauri initializes).
    #[cfg(target_os = "linux")]
    unsafe {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    markeron_lib::run()
}
