use std::sync::atomic::{AtomicBool, Ordering};

pub struct Strings {
    pub settings: &'static str,
    pub help: &'static str,
    pub about: &'static str,
    pub quit: &'static str,
    pub window_title: &'static str,
    pub toggle_drawing: &'static str,
    pub clear_drawing: &'static str,
}

const ZH: Strings = Strings {
    settings: "设置",
    help: "使用帮助",
    about: "关于",
    quit: "退出",
    window_title: "MarkerOn 设置",
    toggle_drawing: "开始标注",
    clear_drawing: "清除标注",
};

const EN: Strings = Strings {
    settings: "Settings",
    help: "Help",
    about: "About",
    quit: "Quit",
    window_title: "MarkerOn Settings",
    toggle_drawing: "Toggle annotation",
    clear_drawing: "Clear annotations",
};

static USE_CHINESE: AtomicBool = AtomicBool::new(false);

pub fn init(locale: Option<&str>) {
    let chinese = match locale {
        Some(l) => l.starts_with("zh"),
        None => detect_chinese(),
    };
    USE_CHINESE.store(chinese, Ordering::Relaxed);
}

pub fn set_locale(locale: &str) {
    USE_CHINESE.store(locale.starts_with("zh"), Ordering::Relaxed);
}

pub fn strings() -> &'static Strings {
    if USE_CHINESE.load(Ordering::Relaxed) { &ZH } else { &EN }
}

fn detect_chinese() -> bool {
    #[cfg(target_os = "windows")]
    {
        let lang = std::env::var("LANG")
            .or_else(|_| std::env::var("LANGUAGE"))
            .unwrap_or_default();
        if lang.starts_with("zh") {
            return true;
        }
        use std::os::raw::c_int;
        extern "system" {
            fn GetUserDefaultUILanguage() -> u16;
        }
        let lang_id = unsafe { GetUserDefaultUILanguage() } as c_int;
        let primary = lang_id & 0xFF;
        primary == 0x04
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("LANG")
            .unwrap_or_default()
            .starts_with("zh")
            || std::process::Command::new("defaults")
                .args(["read", "-g", "AppleLanguages"])
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).contains("zh"))
                .unwrap_or(false)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var("LANG")
            .unwrap_or_default()
            .starts_with("zh")
    }
}
