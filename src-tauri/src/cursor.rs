use crate::AppState;
use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

#[derive(Clone, Serialize, Debug)]
pub struct CursorEdgeEvent {
    pub x: f64,
    pub y: f64,
    pub in_edge: bool,
    pub in_zone: bool,
    pub stick_position: String,
    pub display_width: f64,
    pub display_height: f64,
}

#[derive(Debug, Clone, PartialEq)]
enum EdgeState {
    Closed,
    DwellTimer { since: std::time::Instant },
    Open,
    GraceTimer { since: std::time::Instant },
}

const KEEP_OPEN_PX: f64 = 400.0;
const START_CLOSE_PX: f64 = 420.0;

/// Poll cursor position using Tauri's safe API (no raw objc2).
pub async fn run_cursor_poll(app_handle: AppHandle, state: Arc<AppState>) {
    let mut edge_state = EdgeState::Closed;
    let mut last_edge_state = false;

    loop {
        {
            let quitting = state.quitting.lock().await;
            if *quitting {
                break;
            }
        }

        let cursor_pos = match app_handle.cursor_position() {
            Ok(p) => p,
            Err(_) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(16)).await;
                continue;
            }
        };

        let display = get_display_info(&app_handle);
        let client_x = cursor_pos.x as f64 - display.x;
        let client_y = cursor_pos.y as f64 - display.y;
        let settings = state.settings.read().await.clone();
        let zone_height = display.height * settings.hot_zone_height;
        let zone_top = (display.height - zone_height) / 2.0;

        let in_edge = client_x >= -30.0
            && client_x <= settings.hot_zone_width
            && client_y >= zone_top
            && client_y <= zone_top + zone_height;

        edge_state = match &edge_state {
            EdgeState::Closed => {
                if in_edge {
                    EdgeState::DwellTimer {
                        since: std::time::Instant::now(),
                    }
                } else {
                    EdgeState::Closed
                }
            }
            EdgeState::DwellTimer { since } => {
                if !in_edge {
                    EdgeState::Closed
                } else if since.elapsed().as_millis() >= settings.open_delay_ms as u128 {
                    EdgeState::Open
                } else {
                    edge_state.clone()
                }
            }
            EdgeState::Open => {
                if client_x > START_CLOSE_PX {
                    EdgeState::GraceTimer {
                        since: std::time::Instant::now(),
                    }
                } else {
                    EdgeState::Open
                }
            }
            EdgeState::GraceTimer { since } => {
                if client_x <= KEEP_OPEN_PX {
                    EdgeState::Open
                } else if since.elapsed().as_millis() >= settings.close_delay_ms as u128 {
                    EdgeState::Closed
                } else {
                    edge_state.clone()
                }
            }
        };

        let is_open = matches!(edge_state, EdgeState::Open);

        {
            let mut interactive = state.interactive.lock().await;
            if is_open != *interactive {
                *interactive = is_open;
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = crate::window::set_interactive(&window, is_open);
                    let _ = app_handle.emit("panel-toggle", is_open);
                }
            }
        }

        let near_edge = client_x <= 450.0;
        let edge_changed = in_edge != last_edge_state;

        if near_edge || is_open || edge_changed {
            last_edge_state = in_edge;
            let event = CursorEdgeEvent {
                x: client_x,
                y: client_y,
                in_edge,
                in_zone: true,
                stick_position: "left".to_string(),
                display_width: display.width,
                display_height: display.height,
            };
            let _ = app_handle.emit("cursor-edge", event);
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(16)).await;
    }
}

struct DisplayInfo {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn get_display_info(handle: &AppHandle) -> DisplayInfo {
    if let Ok(Some(monitor)) = handle.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        return DisplayInfo {
            x: pos.x as f64,
            y: pos.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        };
    }
    DisplayInfo {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    }
}
