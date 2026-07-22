use crate::{
    motion::{clamp_to_work_area, step_toward, DragDirection, DragTracker, Point, WorkArea},
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
        let mut drag_tracker = DragTracker::default();
        let mut drag_animation = None;
        let mut drag_moved = false;
        let mut was_dragging = false;
        loop {
            tokio::time::sleep(Duration::from_millis(33)).await;
            let Some(window) = app.get_webview_window("pet") else {
                continue;
            };
            let state = app.state::<AppState>();
            if state.dragging.load(Ordering::Relaxed) && !is_left_button_pressed() {
                // On Windows, tao's drag_window returns as soon as the OS drag begins,
                // so the frontend's dragging flag can be cleared while the drag is still
                // in flight. Treat the physical button release as the end of the drag so
                // the motion engine never fights the cursor mid-drag.
                state.dragging.store(false, Ordering::Relaxed);
            }
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
            let dragging = state.dragging.load(Ordering::Relaxed);
            if dragging {
                state.moving.store(false, Ordering::Relaxed);
                target = None;
                if let Ok(position) = window.outer_position() {
                    let current = Point {
                        x: position.x as f64,
                        y: position.y as f64,
                    };
                    let observation =
                        drag_tracker.observe(current, 2.0, !settings.pet.roaming_enabled);
                    if observation.moved && !drag_moved {
                        drag_moved = true;
                        let _ = app.emit("runtime://drag-moved", ());
                    }
                    if observation.start_visual {
                        let _ = app.emit(
                            "runtime://drag-animation",
                            AnimationPayload {
                                state: "idle",
                                direction_degrees: None,
                            },
                        );
                    }
                    if let Some(direction) = observation.direction {
                        if drag_animation != Some(direction) {
                            drag_animation = Some(direction);
                            let _ = app.emit(
                                "runtime://drag-animation",
                                AnimationPayload {
                                    state: match direction {
                                        DragDirection::Left => "running-left",
                                        DragDirection::Right => "running-right",
                                    },
                                    direction_degrees: None,
                                },
                            );
                        }
                    }
                }
                was_dragging = true;
                continue;
            }
            if was_dragging {
                was_dragging = false;
                drag_tracker = DragTracker::default();
                drag_animation = None;
                drag_moved = false;
                let _ = app.emit("runtime://drag-ended", ());
            }
            if state.interacting.load(Ordering::Relaxed) {
                state.moving.store(false, Ordering::Relaxed);
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
    app.state::<AppState>()
        .paused
        .store(false, Ordering::Relaxed);
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
fn is_left_button_pressed() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 }
}

#[cfg(not(windows))]
fn is_left_button_pressed() -> bool {
    false
}

#[cfg(windows)]
fn is_foreground_fullscreen(pet: &tauri::WebviewWindow) -> bool {
    use windows::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect},
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
        let fills_monitor = (rect.left - info.rcMonitor.left).abs() <= 2
            && (rect.top - info.rcMonitor.top).abs() <= 2
            && (rect.right - info.rcMonitor.right).abs() <= 2
            && (rect.bottom - info.rcMonitor.bottom).abs() <= 2;
        let mut class_name = [0_u16; 256];
        let class_length = GetClassNameW(foreground, &mut class_name);
        let class_name = String::from_utf16_lossy(&class_name[..class_length.max(0) as usize]);
        is_fullscreen_window_class(&class_name, fills_monitor)
    }
}

#[cfg(windows)]
fn is_fullscreen_window_class(class_name: &str, fills_monitor: bool) -> bool {
    fills_monitor && !matches!(class_name, "Progman" | "WorkerW")
}

#[cfg(all(test, windows))]
mod tests {
    use super::is_fullscreen_window_class;

    #[test]
    fn windows_desktop_is_not_a_fullscreen_app() {
        assert!(!is_fullscreen_window_class("Progman", true));
        assert!(!is_fullscreen_window_class("WorkerW", true));
        assert!(is_fullscreen_window_class("Chrome_WidgetWin_1", true));
    }
}

#[cfg(not(windows))]
fn is_foreground_fullscreen(_: &tauri::WebviewWindow) -> bool {
    false
}
