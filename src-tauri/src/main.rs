#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force X11 backend via XWayland on Wayland sessions.
    // GDK_BACKEND=x11 affects GTK; removing WAYLAND_DISPLAY forces tao (the
    // windowing layer) to also fall back to X11 instead of native Wayland.
    // Must be set before any threads are spawned (before Tauri initializes).
    #[cfg(target_os = "linux")]
    unsafe {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::remove_var("WAYLAND_DISPLAY");
    }

    markeron_lib::run()
}
