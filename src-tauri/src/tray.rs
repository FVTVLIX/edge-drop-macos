use crate::AppState;
use std::sync::Arc;
use tauri::Manager;
use tauri::{App, Emitter};

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
    let tray_icon = tauri::include_image!("../public/tray-icon.png");

    let _tray = TrayIconBuilder::new()
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("Edge Drop")
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "quit" => {
                let state = app_handle.state::<Arc<AppState>>();
                *state.quitting.blocking_lock() = true;
                app_handle.exit(0);
            }
            "toggle" => {
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    crate::toggle_manual_panel(app_handle).await;
                });
            }
            "clear" => {
                let state = app_handle.state::<Arc<AppState>>();
                let mut store = state.item_store.blocking_lock();
                store.clear_unpinned();
                let items = store.list().to_vec();
                if let Some(window) = store.get_window() {
                    let _ = window.emit(
                        "clipboard-update",
                        crate::clipboard::ClipboardUpdate { items },
                    );
                }
                drop(store);
                state.clipboard_watcher.blocking_lock().baseline_pending = true;
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
                let app_handle = tray.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    crate::toggle_manual_panel(app_handle).await;
                });
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn setup_tray(_app: &App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
