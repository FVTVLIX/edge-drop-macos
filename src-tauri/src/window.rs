use serde::Serialize;
use tauri::{App, AppHandle, Manager, Monitor};

pub const PANEL_WIDTH: f64 = 384.0;
pub const FLYOUT_GAP: f64 = 12.0;
pub const FLYOUT_WIDTH: f64 = 420.0;
pub const WINDOW_WIDTH: f64 = PANEL_WIDTH + FLYOUT_GAP + FLYOUT_WIDTH;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayOption {
    pub id: String,
    pub label: String,
    pub primary: bool,
}

pub fn monitor_id(monitor: &Monitor) -> String {
    let position = monitor.position();
    let size = monitor.size();
    format!(
        "{}|{},{}|{}x{}",
        monitor.name().map(String::as_str).unwrap_or("Display"),
        position.x,
        position.y,
        size.width,
        size.height
    )
}

fn same_monitor(left: &Monitor, right: &Monitor) -> bool {
    left.position() == right.position() && left.size() == right.size()
}

pub fn resolve_monitor(handle: &AppHandle, requested_id: &str) -> tauri::Result<Option<Monitor>> {
    let primary = handle.primary_monitor()?;
    if requested_id == "primary" {
        return Ok(primary);
    }
    let monitors = handle.available_monitors()?;
    Ok(monitors
        .into_iter()
        .find(|monitor| monitor_id(monitor) == requested_id)
        .or(primary))
}

pub fn display_options(handle: &AppHandle) -> tauri::Result<Vec<DisplayOption>> {
    let primary = handle.primary_monitor()?;
    let mut monitors = handle.available_monitors()?;
    monitors.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    let primary_x = primary
        .as_ref()
        .map(|monitor| monitor.position().x)
        .unwrap_or(0);
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let is_primary = primary
                .as_ref()
                .is_some_and(|primary| same_monitor(monitor, primary));
            let side = if is_primary {
                "Primary"
            } else if monitor.position().x < primary_x {
                "Left"
            } else {
                "Right"
            };
            let size = monitor.size();
            DisplayOption {
                id: monitor_id(monitor),
                label: format!(
                    "Display {} · {} · {}×{}",
                    index + 1,
                    side,
                    size.width,
                    size.height
                ),
                primary: is_primary,
            }
        })
        .collect())
}

pub fn setup_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let window = handle
        .get_webview_window("main")
        .ok_or("window not found in config")?;

    let settings = app.state::<std::sync::Arc<crate::AppState>>();
    let settings_value = settings.settings.blocking_read().clone();
    let monitor = resolve_monitor(handle, &settings_value.display_id)?.ok_or("no monitor")?;
    let screen_size = monitor.size();
    let scale = monitor.scale_factor();
    window.set_size(tauri::Size::Logical(
        (WINDOW_WIDTH, screen_size.height as f64 / scale).into(),
    ))?;
    position_window(&window, &monitor, &settings_value.edge_position)?;
    window.set_ignore_cursor_events(true)?;
    window.set_always_on_top(true)?;
    window.show()?;

    Ok(())
}

pub fn position_window(
    window: &tauri::WebviewWindow,
    monitor: &tauri::Monitor,
    edge_position: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let scale = monitor.scale_factor();
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let monitor_x = monitor_position.x as f64 / scale;
    let monitor_y = monitor_position.y as f64 / scale;
    let monitor_width = monitor_size.width as f64 / scale;
    let x = if edge_position == "right" {
        monitor_x + monitor_width - WINDOW_WIDTH
    } else {
        monitor_x
    };
    window.set_position(tauri::LogicalPosition::new(x, monitor_y))?;
    window.set_size(tauri::LogicalSize::new(
        WINDOW_WIDTH,
        monitor_size.height as f64 / scale,
    ))?;
    Ok(())
}

pub fn set_interactive(
    window: &tauri::WebviewWindow,
    interactive: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    window.set_ignore_cursor_events(!interactive)?;
    window.set_always_on_top(true)?;
    Ok(())
}
