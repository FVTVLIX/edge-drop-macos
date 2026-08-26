use tauri::{App, Manager};

pub const PANEL_WIDTH: f64 = 384.0;
pub const FLYOUT_GAP: f64 = 12.0;
pub const FLYOUT_WIDTH: f64 = 420.0;
pub const WINDOW_WIDTH: f64 = PANEL_WIDTH + FLYOUT_GAP + FLYOUT_WIDTH;

pub fn setup_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let window = handle
        .get_webview_window("main")
        .ok_or("window not found in config")?;

    let monitor = handle.primary_monitor()?.ok_or("no primary monitor")?;
    let screen_size = monitor.size();
    let scale = monitor.scale_factor();
    let settings = app.state::<std::sync::Arc<crate::AppState>>();
    let edge_position = settings.settings.blocking_read().edge_position.clone();
    window.set_size(tauri::Size::Logical(
        (WINDOW_WIDTH, screen_size.height as f64 / scale).into(),
    ))?;
    position_window(&window, &monitor, &edge_position)?;
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
