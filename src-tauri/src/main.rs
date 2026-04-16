#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force X11 backend via XWayland on Wayland sessions.
    // GDK_BACKEND affects GTK, and WINIT_UNIX_BACKEND affects tao/winit.
    // Removing WAYLAND_DISPLAY prevents native Wayland initialization.
    // Must be set before any threads are spawned (before Tauri initializes).
    #[cfg(target_os = "linux")]
    unsafe {
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WINIT_UNIX_BACKEND", "x11");
        std::env::remove_var("WAYLAND_DISPLAY");
    }

    markeron_lib::run()
}
