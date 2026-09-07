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
const FLYOUT_KEEP_OPEN_PX: f64 = crate::window::WINDOW_WIDTH;
const REST_FRAMES_REQUIRED: u8 = 3;
const MAX_INTENT_SPEED_PX_PER_MS: f64 = 1.5;

#[derive(Default)]
struct SeamTracker {
    last_point: Option<(f64, f64)>,
    last_distance: Option<f64>,
    last_time: Option<std::time::Instant>,
    crossing_pending: bool,
    rest_streak: u8,
}

impl SeamTracker {
    fn probe(
        &mut self,
        x: f64,
        y: f64,
        edge_distance: f64,
        hot_zone_width: f64,
        now: std::time::Instant,
    ) -> bool {
        let speed = self
            .last_point
            .zip(self.last_time)
            .map(|((last_x, last_y), last_time)| {
                let elapsed_ms = now.duration_since(last_time).as_secs_f64() * 1000.0;
                let elapsed_ms = elapsed_ms.clamp(1.0, 250.0);
                (x - last_x).hypot(y - last_y) / elapsed_ms
            });
        let slow_enough = speed.is_none_or(|speed| speed <= MAX_INTENT_SPEED_PX_PER_MS);
        let crossed = self.last_distance.is_some_and(|last_distance| {
            (last_distance < 0.0 && edge_distance >= 0.0)
                || (last_distance >= 0.0 && edge_distance < 0.0)
        });

        if crossed {
            self.crossing_pending = true;
            self.rest_streak = 0;
        } else if self.crossing_pending {
            if edge_distance >= 0.0 && edge_distance <= hot_zone_width && slow_enough {
                self.rest_streak = self.rest_streak.saturating_add(1);
            } else {
                self.rest_streak = 0;
            }
            if self.rest_streak >= REST_FRAMES_REQUIRED {
                self.crossing_pending = false;
            }
        }

        self.last_point = Some((x, y));
        self.last_distance = Some(edge_distance);
        self.last_time = Some(now);

        !self.crossing_pending
            && edge_distance >= 0.0
            && edge_distance <= hot_zone_width
            && slow_enough
    }
}

/// Poll cursor position using Tauri's safe API (no raw objc2).
pub async fn run_cursor_poll(app_handle: AppHandle, state: Arc<AppState>) {
    let mut edge_state = EdgeState::Closed;
    let mut last_edge_state = false;
    let mut accepting_input = false;
    let mut cached_display_id = String::new();
    let mut cached_edge_position = String::new();
    let mut display = get_display_info(&app_handle, "primary");
    let mut display_refreshed_at = std::time::Instant::now();
    let mut seam_tracker = SeamTracker::default();

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

        let settings = state.settings.read().await.clone();
        if cached_display_id != settings.display_id
            || cached_edge_position != settings.edge_position
            || display_refreshed_at.elapsed() >= std::time::Duration::from_secs(2)
        {
            let next_display = get_display_info(&app_handle, &settings.display_id);
            if cached_display_id != settings.display_id
                || cached_edge_position != settings.edge_position
                || next_display.x != display.x
                || next_display.y != display.y
                || next_display.width != display.width
                || next_display.height != display.height
            {
                seam_tracker = SeamTracker::default();
            }
            display = next_display;
            cached_display_id = settings.display_id.clone();
            cached_edge_position = settings.edge_position.clone();
            display_refreshed_at = std::time::Instant::now();
        }
        let client_x = cursor_pos.x as f64 - display.x;
        let client_y = cursor_pos.y as f64 - display.y;
        let is_right = settings.edge_position == "right";
        let panel_height = display.height * settings.panel_height;
        let panel_top = (display.height - panel_height) * settings.vertical_offset;
        let zone_height = display.height * settings.hot_zone_height;
        let zone_top = match settings.trigger_alignment.as_str() {
            "top" => panel_top,
            "bottom" => panel_top + panel_height - zone_height,
            _ => panel_top + (panel_height - zone_height) / 2.0,
        }
        .clamp(0.0, (display.height - zone_height).max(0.0));

        let edge_distance = if is_right {
            display.width - client_x
        } else {
            client_x
        };
        let suppressed = {
            let mut suppress_until = state.suppress_edge_until.lock().await;
            if suppress_until.is_some_and(|until| std::time::Instant::now() >= until) {
                *suppress_until = None;
            }
            suppress_until.is_some()
        };
        let at_edge = seam_tracker.probe(
            cursor_pos.x as f64,
            cursor_pos.y as f64,
            edge_distance,
            settings.hot_zone_width * display.scale,
            std::time::Instant::now(),
        );
        let in_zone = client_y >= zone_top && client_y <= zone_top + zone_height;
        let in_edge = settings.hover_activation && !suppressed && at_edge && in_zone;

        let manual_open = *state.manual_open.lock().await;
        edge_state = if manual_open {
            EdgeState::Open
        } else if suppressed {
            EdgeState::Closed
        } else {
            match &edge_state {
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
                    let preview_open = *state.preview_open.lock().await;
                    let close_at = if preview_open {
                        FLYOUT_KEEP_OPEN_PX
                    } else {
                        START_CLOSE_PX
                    } * display.scale;
                    if edge_distance > close_at {
                        EdgeState::GraceTimer {
                            since: std::time::Instant::now(),
                        }
                    } else {
                        EdgeState::Open
                    }
                }
                EdgeState::GraceTimer { since } => {
                    let preview_open = *state.preview_open.lock().await;
                    let keep_open_at = if preview_open {
                        FLYOUT_KEEP_OPEN_PX
                    } else {
                        KEEP_OPEN_PX
                    } * display.scale;
                    if edge_distance <= keep_open_at {
                        EdgeState::Open
                    } else if since.elapsed().as_millis() >= settings.close_delay_ms as u128 {
                        EdgeState::Closed
                    } else {
                        edge_state.clone()
                    }
                }
            }
        };

        let is_open = matches!(edge_state, EdgeState::Open);

        let preview_open = *state.preview_open.lock().await;
        {
            let mut interactive = state.interactive.lock().await;
            if is_open != *interactive {
                *interactive = is_open;
                let _ = app_handle.emit("panel-toggle", is_open);
            }
        }

        // Preserve the original full-size transparent rendering canvas, but
        // only let it receive mouse input over visible UI. Everywhere else the
        // window becomes click-through so applications behind it remain usable.
        let in_panel = edge_distance >= 0.0
            && edge_distance <= crate::window::PANEL_WIDTH * display.scale
            && client_y >= panel_top
            && client_y <= panel_top + panel_height;
        let flyout_top = (display.height - panel_height) / 2.0;
        let in_flyout = preview_open
            && edge_distance
                >= (crate::window::PANEL_WIDTH + crate::window::FLYOUT_GAP) * display.scale
            && edge_distance <= crate::window::WINDOW_WIDTH * display.scale
            && client_y >= flyout_top
            && client_y <= flyout_top + panel_height;
        let should_accept_input = is_open && (in_panel || in_flyout);
        if should_accept_input != accepting_input {
            accepting_input = should_accept_input;
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = crate::window::set_interactive(&window, accepting_input);
            }
        }

        let near_edge = edge_distance <= (crate::window::WINDOW_WIDTH + 32.0) * display.scale;
        let edge_changed = in_edge != last_edge_state;

        if near_edge || is_open || edge_changed {
            last_edge_state = in_edge;
            let event = CursorEdgeEvent {
                x: if is_right {
                    (client_x - (display.width - crate::window::WINDOW_WIDTH * display.scale))
                        / display.scale
                } else {
                    client_x / display.scale
                },
                y: client_y / display.scale,
                in_edge,
                in_zone,
                stick_position: settings.edge_position.clone(),
                display_width: display.width / display.scale,
                display_height: display.height / display.scale,
            };
            let _ = app_handle.emit("cursor-edge", event);
        }

        // Poll at animation cadence only while the pointer can interact with
        // the shelf. Far from the edge, reduce timer wakeups substantially.
        let poll_ms = if near_edge || is_open || in_edge {
            16
        } else {
            75
        };
        tokio::time::sleep(tokio::time::Duration::from_millis(poll_ms)).await;
    }
}

struct DisplayInfo {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

fn get_display_info(handle: &AppHandle, display_id: &str) -> DisplayInfo {
    if let Ok(Some(monitor)) = crate::window::resolve_monitor(handle, display_id) {
        let size = monitor.size();
        let pos = monitor.position();
        return DisplayInfo {
            x: pos.x as f64,
            y: pos.y as f64,
            width: size.width as f64,
            height: size.height as f64,
            scale: monitor.scale_factor(),
        };
    }
    DisplayInfo {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
        scale: 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seam_crossing_requires_three_slow_frames_on_the_selected_display() {
        let started = std::time::Instant::now();
        let mut tracker = SeamTracker::default();
        assert!(!tracker.probe(99.0, 50.0, -1.0, 4.0, started));
        assert!(!tracker.probe(
            100.0,
            50.0,
            0.0,
            4.0,
            started + std::time::Duration::from_millis(16)
        ));
        assert!(!tracker.probe(
            101.0,
            50.0,
            1.0,
            4.0,
            started + std::time::Duration::from_millis(32)
        ));
        assert!(!tracker.probe(
            101.0,
            50.0,
            1.0,
            4.0,
            started + std::time::Duration::from_millis(48)
        ));
        assert!(tracker.probe(
            101.0,
            50.0,
            1.0,
            4.0,
            started + std::time::Duration::from_millis(64)
        ));
    }

    #[test]
    fn fast_travel_through_the_edge_band_does_not_arm() {
        let started = std::time::Instant::now();
        let mut tracker = SeamTracker::default();
        assert!(tracker.probe(90.0, 50.0, 3.0, 4.0, started));
        assert!(!tracker.probe(
            130.0,
            50.0,
            2.0,
            4.0,
            started + std::time::Duration::from_millis(16)
        ));
    }
}
