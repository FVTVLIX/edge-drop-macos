use crate::AppState;
use std::sync::Arc;
use tauri::App;
use tauri::Manager;

/// Set up the macOS menu bar status item.
#[cfg(target_os = "macos")]
pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let quit_item = MenuItemBuilder::with_id("quit", "Quit Edge Drop").build(app)?;
    let toggle_item = MenuItemBuilder::with_id("toggle", "Show/Hide Panel").build(app)?;
    let clear_item = MenuItemBuilder::with_id("clear", "Clear Unpinned Items").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&toggle_item)
        .item(&clear_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Edge Drop")
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "quit" => {
                let state = app_handle.state::<Arc<AppState>>();
                *state.quitting.blocking_lock() = true;
                app_handle.exit(0);
            }
            "toggle" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_always_on_top(true);
                }
            }
            "clear" => {
                let state = app_handle.state::<Arc<AppState>>();
                let mut store = state.item_store.blocking_lock();
                let ids: Vec<String> = store
                    .list()
                    .iter()
                    .filter(|i| !i.pinned)
                    .map(|i| i.id.clone())
                    .collect();
                for id in ids {
                    store.delete(&id);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let state = tray.app_handle().state::<Arc<AppState>>();
                    let interactive = state.interactive.blocking_lock();
                    if *interactive {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_always_on_top(true);
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn setup_tray(_app: &App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
