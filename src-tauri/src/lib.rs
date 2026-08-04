use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;

mod clipboard;
mod clipboard_write;
mod cursor;
mod drag;
mod settings;
mod store;
mod tray;
mod window;

pub use crate::store::ItemStore;

pub struct AppState {
    pub item_store: tokio::sync::Mutex<ItemStore>,
    pub clipboard_watcher: tokio::sync::Mutex<clipboard::ClipboardWatcher>,
    pub settings: tokio::sync::RwLock<settings::AppSettings>,
    pub interactive: tokio::sync::Mutex<bool>,
    pub quitting: tokio::sync::Mutex<bool>,
}

impl AppState {
    fn new() -> Self {
        let settings = settings::AppSettings::load();
        let mut item_store = ItemStore::new();
        item_store.set_history_limit(settings.history_limit);
        let mut clipboard_watcher = clipboard::ClipboardWatcher::new(100);
        clipboard_watcher.set_paused(settings.incognito);
        Self {
            item_store: tokio::sync::Mutex::new(item_store),
            clipboard_watcher: tokio::sync::Mutex::new(clipboard_watcher),
            settings: tokio::sync::RwLock::new(settings),
            interactive: tokio::sync::Mutex::new(false),
            quitting: tokio::sync::Mutex::new(false),
        }
    }
}

#[tauri::command]
async fn get_items(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<store::ClipboardItem>, String> {
    let store = state.item_store.lock().await;
    Ok(store.list().to_vec())
}

#[tauri::command]
async fn start_drag(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
    request: drag::DragRequest,
) -> Result<(), String> {
    let item = {
        let store = state.item_store.lock().await;
        store
            .list()
            .iter()
            .find(|item| item.id == request.id)
            .cloned()
            .ok_or_else(|| "item not found".to_string())?
    };

    let preview_size = state.settings.read().await.drag_preview_size;
    drag::start_native_drag(window, item, request, preview_size).await
}

#[tauri::command]
async fn get_settings(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<settings::AppSettings, String> {
    Ok(state.settings.read().await.clone())
}

#[tauri::command]
async fn update_settings(
    state: tauri::State<'_, Arc<AppState>>,
    settings: settings::AppSettings,
) -> Result<settings::AppSettings, String> {
    let settings = settings.sanitized();
    let previous = state.settings.read().await.clone();
    settings.persist()?;
    state
        .clipboard_watcher
        .lock()
        .await
        .set_paused(settings.incognito);
    if previous.history_limit != settings.history_limit {
        let mut store = state.item_store.lock().await;
        store.set_history_limit(settings.history_limit);
        let items = store.list().to_vec();
        if let Some(window) = store.get_window() {
            let _ = window.emit(
                "clipboard-update",
                crate::clipboard::ClipboardUpdate { items },
            );
        }
    }
    *state.settings.write().await = settings.clone();
    Ok(settings)
}

#[tauri::command]
async fn delete_item(state: tauri::State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let mut store = state.item_store.lock().await;
    store.delete(&id);
    Ok(())
}

#[tauri::command]
async fn toggle_pin(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let mut store = state.item_store.lock().await;
    store.set_pinned(&id, pinned);
    Ok(())
}

#[tauri::command]
async fn clear_items(state: tauri::State<'_, Arc<AppState>>) -> Result<(), String> {
    let mut store = state.item_store.lock().await;
    let ids: Vec<String> = store
        .list()
        .iter()
        .filter(|i| !i.pinned)
        .map(|i| i.id.clone())
        .collect();
    for id in ids {
        store.delete(&id);
    }
    Ok(())
}

#[tauri::command]
async fn copy_item(
    state: tauri::State<'_, Arc<AppState>>,
    request: drag::DragRequest,
) -> Result<(), String> {
    let item = {
        let store = state.item_store.lock().await;
        store
            .list()
            .iter()
            .find(|item| item.id == request.id)
            .cloned()
            .ok_or_else(|| "item not found".to_string())?
    };

    state.clipboard_watcher.lock().await.begin_self_write();
    let result = clipboard_write::write_item(&item, &request);
    state.clipboard_watcher.lock().await.finish_self_write();
    result
}

/// Load an image preview from disk and return as base64 data URL.
#[tauri::command]
async fn get_image_preview(image_id: String) -> Result<String, String> {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.andresgonzalez.mac-edge-drop")
        .join("images");
    let path = data_dir.join(format!("{}.png", image_id));
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Handle files dropped onto the panel — returns updated items.
#[tauri::command]
async fn handle_file_drop(
    state: tauri::State<'_, Arc<AppState>>,
    paths: Vec<String>,
) -> Result<Vec<store::ClipboardItem>, String> {
    if paths.is_empty() {
        let store = state.item_store.lock().await;
        return Ok(store.list().to_vec());
    }

    let mut unique_paths = Vec::new();
    for path in paths {
        let path = std::path::PathBuf::from(path);
        if drag::is_staged_drag_path(&path) || !path.exists() {
            continue;
        }
        let absolute = path
            .canonicalize()
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        if !unique_paths.contains(&absolute) {
            unique_paths.push(absolute);
        }
    }

    let mut imported_images = Vec::new();
    let mut regular_files = Vec::new();
    for path in unique_paths {
        if is_importable_image(&path) {
            match import_dropped_image(&path) {
                Ok(image) => imported_images.push(image),
                Err(_) => regular_files.push(path),
            }
        } else {
            regular_files.push(path);
        }
    }

    let mut store = state.item_store.lock().await;
    for images in imported_images.chunks(store::MAX_STACK) {
        if images.len() == 1 {
            let image = &images[0];
            store.add(store::ItemData::Image {
                image_id: image.image_id.clone(),
                width: image.width,
                height: image.height,
                bytes: image.bytes,
                ext: image.ext.clone(),
            });
        } else {
            store.add(store::ItemData::ImageCollection {
                images: images.to_vec(),
            });
        }
    }
    for files in regular_files.chunks(store::MAX_STACK) {
        store.add_files(files.to_vec());
    }

    Ok(store.list().to_vec())
}

fn is_importable_image(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "tif"
            )
        })
        .unwrap_or(false)
}

fn import_dropped_image(path: &str) -> Result<store::ImageEntry, String> {
    let decoded = image::open(path).map_err(|e| e.to_string())?;
    let rgba = decoded.to_rgba8();
    let image_id = store::image_content_id(decoded.width(), decoded.height(), rgba.as_raw());
    let image_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.andresgonzalez.mac-edge-drop")
        .join("images");
    std::fs::create_dir_all(&image_dir).map_err(|e| e.to_string())?;
    let destination = image_dir.join(format!("{image_id}.png"));
    if !destination.exists() {
        decoded
            .save_with_format(&destination, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
    }
    let bytes = std::fs::metadata(&destination)
        .map_err(|e| e.to_string())?
        .len();

    Ok(store::ImageEntry {
        image_id,
        width: decoded.width(),
        height: decoded.height(),
        bytes,
        ext: Some("png".to_string()),
    })
}

/// Import text, rich text, or a URL dragged directly from another application.
#[tauri::command]
async fn handle_content_drop(
    state: tauri::State<'_, Arc<AppState>>,
    text: String,
    html: Option<String>,
) -> Result<Vec<store::ClipboardItem>, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("dropped content was empty".to_string());
    }
    let is_url = text.starts_with("http://") || text.starts_with("https://");
    let mut store = state.item_store.lock().await;
    store.add(store::ItemData::Text {
        text,
        html: html.filter(|value| !value.trim().is_empty()),
        is_url,
        is_color: false,
    });
    Ok(store.list().to_vec())
}

/// Merge two items together (both must be same kind).
#[tauri::command]
async fn merge_items(
    state: tauri::State<'_, Arc<AppState>>,
    source_id: String,
    target_id: String,
) -> Result<Vec<store::ClipboardItem>, String> {
    let mut store = state.item_store.lock().await;
    store
        .merge(&source_id, &target_id)
        .map_err(|e| e.to_string())?;
    let items = store.list().to_vec();
    if let Some(window) = store.get_window() {
        let _ = window.emit(
            "clipboard-update",
            crate::clipboard::ClipboardUpdate { items },
        );
    }
    Ok(store.list().to_vec())
}

/// Split a sub-item out of a bundle into its own item.
#[tauri::command]
async fn split_item(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
    image_id: Option<String>,
    paths: Option<Vec<String>>,
) -> Result<Vec<store::ClipboardItem>, String> {
    let mut store = state.item_store.lock().await;
    store
        .split(&id, image_id.as_deref(), paths.as_ref())
        .map_err(|e| e.to_string())?;
    let items = store.list().to_vec();
    if let Some(window) = store.get_window() {
        let _ = window.emit(
            "clipboard-update",
            crate::clipboard::ClipboardUpdate { items },
        );
    }
    Ok(store.list().to_vec())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![
            get_items,
            get_settings,
            update_settings,
            start_drag,
            delete_item,
            toggle_pin,
            clear_items,
            copy_item,
            get_image_preview,
            merge_items,
            split_item,
            handle_file_drop,
            handle_content_drop,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Create and configure the transparent edge window
            window::setup_window(app)?;

            // Wire up the item store
            {
                let state: tauri::State<'_, Arc<AppState>> = app.state();
                if let Some(window) = handle.get_webview_window("main") {
                    state.item_store.blocking_lock().set_window(window);
                }
            }

            // Try tray — wrapped in a result so it doesn't crash
            match tray::setup_tray(app) {
                Ok(_) => println!("Tray set up OK"),
                Err(e) => eprintln!("Tray setup failed: {}", e),
            }

            // Try cursor poll
            {
                let state: tauri::State<'_, Arc<AppState>> = app.state();
                let arc = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    cursor::run_cursor_poll(handle.clone(), arc).await;
                });
            }

            // Try clipboard watch
            {
                let state: tauri::State<'_, Arc<AppState>> = app.state();
                let arc = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    clipboard::watch_clipboard(arc).await;
                });
            }

            drag::clean_temp();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
