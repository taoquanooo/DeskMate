use crate::{
    motion::{clamp_to_work_area, step_toward, Point, WorkArea},
    AppState,
};
use rand::Rng;
use serde::Serialize;
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, PhysicalPosition};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnimationPayload {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    direction_degrees: Option<f64>,
}

pub fn start_motion_engine(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut target: Option<Point> = None;
        let mut idle_until: Option<Instant> = None;
        let mut last_fullscreen = false;
        loop {
            tokio::time::sleep(Duration::from_millis(33)).await;
            let Some(window) = app.get_webview_window("pet") else {
                continue;
            };
            let state = app.state::<AppState>();
            let settings = state.settings.lock().expect("settings poisoned").clone();
            let fullscreen = is_foreground_fullscreen(&window);
            state.fullscreen.store(fullscreen, Ordering::Relaxed);
            if fullscreen != last_fullscreen {
                last_fullscreen = fullscreen;
                let _ = app.emit("runtime://fullscreen", fullscreen);
            }
            if state.paused.load(Ordering::Relaxed)
                || (fullscreen && settings.pet.hide_in_fullscreen)
            {
                state.moving.store(false, Ordering::Relaxed);
                let _ = window.hide();
                if let Some(bubble) = app.get_webview_window("bubble") {
                    let _ = bubble.hide();
                }
                continue;
            }
            let _ = window.show();
            if state.dragging.load(Ordering::Relaxed) || state.interacting.load(Ordering::Relaxed) {
                state.moving.store(false, Ordering::Relaxed);
                if state.dragging.load(Ordering::Relaxed) {
                    target = None;
                }
                continue;
            }
            if !settings.pet.roaming_enabled || reduced_motion_enabled() {
                target = None;
                if state.moving.swap(false, Ordering::Relaxed) {
                    let _ = app.emit(
                        "runtime://animation",
                        AnimationPayload {
                            state: "idle",
                            direction_degrees: None,
                        },
                    );
                }
                continue;
            }
            let Ok(position) = window.outer_position() else {
                continue;
            };
            let Ok(size) = window.outer_size() else {
                continue;
            };
            let from = Point {
                x: position.x as f64,
                y: position.y as f64,
            };
            if target.is_some_and(|to| (to.x - from.x).hypot(to.y - from.y) < 2.0) {
                target = None;
                state.moving.store(false, Ordering::Relaxed);
                idle_until = Some(
                    Instant::now() + Duration::from_secs(rand::rng().random_range(2_u64..=6_u64)),
                );
                let _ = app.emit(
                    "runtime://animation",
                    AnimationPayload {
                        state: "idle",
                        direction_degrees: None,
                    },
                );
                continue;
            }
            if idle_until.is_some_and(|until| Instant::now() < until) {
                state.moving.store(false, Ordering::Relaxed);
                continue;
            }
            if target.is_none() {
                idle_until = None;
                let areas = work_areas();
                if areas.is_empty() {
                    continue;
                }
                let area = areas[rand::rng().random_range(0..areas.len())];
                let max_x = (area.right - size.width as i32).max(area.left);
                let max_y = (area.bottom - size.height as i32).max(area.top);
                let mut rng = rand::rng();
                let chosen = Point {
                    x: rng.random_range(area.left..=max_x) as f64,
                    y: rng.random_range(area.top..=max_y) as f64,
                };
                target = Some(clamp_to_work_area(
                    chosen,
                    area,
                    size.width as i32,
                    size.height as i32,
                ));
                let _ = app.emit(
                    "runtime://animation",
                    AnimationPayload {
                        state: if chosen.x >= from.x {
                            "running-right"
                        } else {
                            "running-left"
                        },
                        direction_degrees: None,
                    },
                );
            }
            let Some(to) = target else {
                state.moving.store(false, Ordering::Relaxed);
                continue;
            };
            state.moving.store(true, Ordering::Relaxed);
            let scale = window.scale_factor().unwrap_or(1.0);
            let next = step_toward(from, to, settings.pet.speed * scale * 0.033);
            let _ = window.set_position(PhysicalPosition::new(
                next.x.round() as i32,
                next.y.round() as i32,
            ));
        }
    });
}

pub fn recall_to_cursor_monitor(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("pet").ok_or("pet window missing")?;
    let pet_size = window.outer_size().map_err(|error| error.to_string())?;
    let area = cursor_work_area().or_else(|| {
        window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten())
            .map(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                WorkArea {
                    left: position.x,
                    top: position.y,
                    right: position.x + size.width as i32,
                    bottom: position.y + size.height as i32,
                }
            })
    });
    let area = area.ok_or("no monitor available")?;
    let x = area.left + (area.right - area.left - pet_size.width as i32).max(0) / 2;
    let y = area.top + (area.bottom - area.top - pet_size.height as i32).max(0) / 2;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn cursor_work_area() -> Option<WorkArea> {
    use windows::Win32::{
        Foundation::POINT,
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        UI::WindowsAndMessaging::GetCursorPos,
    };
    unsafe {
        let mut cursor = POINT::default();
        GetCursorPos(&mut cursor).ok()?;
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        GetMonitorInfoW(monitor, &mut info)
            .as_bool()
            .then_some(WorkArea {
                left: info.rcWork.left,
                top: info.rcWork.top,
                right: info.rcWork.right,
                bottom: info.rcWork.bottom,
            })
    }
}

#[cfg(not(windows))]
fn cursor_work_area() -> Option<WorkArea> {
    None
}

#[cfg(windows)]
fn work_areas() -> Vec<WorkArea> {
    use windows::{
        core::BOOL,
        Win32::{
            Foundation::{LPARAM, RECT},
            Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO},
        },
    };
    unsafe extern "system" fn callback(
        monitor: HMONITOR,
        _: HDC,
        _: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        let areas = &mut *(data.0 as *mut Vec<WorkArea>);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            areas.push(WorkArea {
                left: info.rcWork.left,
                top: info.rcWork.top,
                right: info.rcWork.right,
                bottom: info.rcWork.bottom,
            });
        }
        BOOL(1)
    }
    let mut areas = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(callback),
            windows::Win32::Foundation::LPARAM((&mut areas as *mut Vec<WorkArea>) as isize),
        );
    }
    areas
}

#[cfg(not(windows))]
fn work_areas() -> Vec<WorkArea> {
    Vec::new()
}

#[cfg(windows)]
fn reduced_motion_enabled() -> bool {
    use windows::{
        core::BOOL,
        Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
        },
    };
    let mut enabled = BOOL(1);
    unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some((&mut enabled as *mut BOOL).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .is_ok()
            && !enabled.as_bool()
    }
}

#[cfg(not(windows))]
fn reduced_motion_enabled() -> bool {
    false
}

#[cfg(windows)]
fn is_foreground_fullscreen(pet: &tauri::WebviewWindow) -> bool {
    use windows::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect},
    };
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() || pet.hwnd().is_ok_and(|handle| handle == foreground) {
            return false;
        }
        let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut rect = RECT::default();
        if !GetMonitorInfoW(monitor, &mut info).as_bool()
            || GetWindowRect(foreground, &mut rect).is_err()
        {
            return false;
        }
        (rect.left - info.rcMonitor.left).abs() <= 2
            && (rect.top - info.rcMonitor.top).abs() <= 2
            && (rect.right - info.rcMonitor.right).abs() <= 2
            && (rect.bottom - info.rcMonitor.bottom).abs() <= 2
    }
}

#[cfg(not(windows))]
fn is_foreground_fullscreen(_: &tauri::WebviewWindow) -> bool {
    false
}
