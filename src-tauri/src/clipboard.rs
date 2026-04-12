#[cfg(target_os = "windows")]
#[tauri::command]
pub fn copy_screen() -> Result<(), String> {
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

        let hdc_screen = GetDC(0);
        if hdc_screen == 0 {
            return Err("Failed to get screen DC".into());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbm = CreateCompatibleBitmap(hdc_screen, w, h);
        let old_obj = SelectObject(hdc_mem, hbm);
        BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, rc.left, rc.top, SRCCOPY);

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

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.header.bi_size = header_size as u32;
        bmi.header.bi_width = w;
        bmi.header.bi_height = h;
        bmi.header.bi_planes = 1;
        bmi.header.bi_bit_count = 32;

        GetDIBits(
            hdc_mem, hbm, 0, h as u32,
            ptr.add(header_size),
            &mut bmi,
            0,
        );

        std::ptr::copy_nonoverlapping(
            &bmi.header as *const _ as *const u8,
            ptr,
            header_size,
        );
        GlobalUnlock(hmem);

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
        if result == 0 {
            GlobalFree(hmem);
        }

        SelectObject(hdc_mem, old_obj);
        DeleteObject(hbm);
        DeleteDC(hdc_mem);
        ReleaseDC(0, hdc_screen);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn copy_screen() -> Result<(), String> {
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
pub fn copy_screen() -> Result<(), String> {
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
