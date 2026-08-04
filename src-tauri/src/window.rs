use tauri::{App, Manager};

pub const PANEL_WIDTH: f64 = 384.0;

pub fn setup_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let window = handle
        .get_webview_window("main")
        .ok_or("window not found in config")?;

    let monitor = handle.primary_monitor()?.ok_or("no primary monitor")?;
    let screen_size = monitor.size();

    // Full-height panel anchored at left edge
    window.set_size(tauri::Size::Logical(
        (PANEL_WIDTH, screen_size.height as f64).into(),
    ))?;
    window.set_position(tauri::LogicalPosition::new(0.0, 0.0))?;

    // Click-through when collapsed
    window.set_ignore_cursor_events(true)?;
    window.set_always_on_top(true)?;
    window.show()?;

    Ok(())
}

/// Toggle between click-through (collapsed) and interactive (open).
pub fn set_interactive(
    window: &tauri::WebviewWindow,
    interactive: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    window.set_ignore_cursor_events(!interactive)?;
    window.set_always_on_top(true)?;
    Ok(())
}
