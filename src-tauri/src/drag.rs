use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, WebviewWindow};

use crate::store::{ClipboardItem, ItemData};

/// Request to start a native drag operation from the frontend.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DragRequest {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(rename = "imageId", skip_serializing_if = "Option::is_none")]
    pub image_id: Option<String>,
}

#[derive(Clone, Serialize)]
struct NativeDragEnded {
    result: String,
    x: f64,
    y: f64,
    inside: bool,
}

/// Resolve a stored clipboard item into real files that AppKit can place on its
/// dragging pasteboard. Text is staged as a temporary UTF-8 file; captured
/// images already have a durable PNG on disk; Finder items retain their paths.
fn resolve_drag_paths(item: &ClipboardItem, request: &DragRequest) -> Result<Vec<PathBuf>, String> {
    let paths = match &item.data {
        ItemData::Text { text, .. } => {
            let temp_dir = get_temp_dir();
            fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
            let path = temp_dir.join(format!("Edge Drop Text {}.txt", item.id));
            fs::write(&path, text).map_err(|e| e.to_string())?;
            vec![path]
        }
        ItemData::Image { image_id, .. } => {
            if request.image_id.as_deref().is_some_and(|id| id != image_id) {
                return Err("image is not part of this item".to_string());
            }
            vec![image_path(image_id)]
        }
        ItemData::ImageCollection { images } => {
            if let Some(image_id) = request.image_id.as_deref() {
                let image = images
                    .iter()
                    .find(|image| image.image_id == image_id)
                    .ok_or_else(|| "image is not part of this stack".to_string())?;
                vec![image_path(&image.image_id)]
            } else {
                images
                    .iter()
                    .map(|image| image_path(&image.image_id))
                    .collect()
            }
        }
        ItemData::Files { paths } => {
            if let Some(selected) = request.paths.as_ref() {
                if selected.is_empty() || selected.iter().any(|path| !paths.contains(path)) {
                    return Err("file is not part of this stack".to_string());
                }
                selected.iter().map(PathBuf::from).collect()
            } else {
                paths.iter().map(PathBuf::from).collect()
            }
        }
    };

    if paths.is_empty() {
        return Err("item has no drag-out content".to_string());
    }

    paths
        .into_iter()
        .map(|path| {
            path.canonicalize()
                .map_err(|e| format!("cannot drag missing item {}: {e}", path.display()))
        })
        .collect()
}

fn image_path(image_id: &str) -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.andresgonzalez.mac-edge-drop")
        .join("images")
        .join(format!("{image_id}.png"))
}

fn can_preview_as_image(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "heic" | "heif"
            )
        })
        .unwrap_or(false)
}

/// Start a real operating-system drag session. This must enter AppKit on the
/// main thread, while the initiating mouse button is still held down.
pub async fn start_native_drag(
    window: WebviewWindow,
    item: ClipboardItem,
    request: DragRequest,
    preview_size: u32,
) -> Result<(), String> {
    let paths = resolve_drag_paths(&item, &request)?;
    let preview_path = paths
        .iter()
        .find(|path| can_preview_as_image(path))
        .cloned();
    let callback_window = window.clone();
    let main_window = window.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();

    window
        .run_on_main_thread(move || {
            let preview = compact_preview(preview_path.as_deref(), preview_size);

            let result = drag::start_drag(
                &main_window,
                drag::DragItem::Files(paths),
                preview,
                move |result, cursor| {
                    let result = match result {
                        drag::DragResult::Dropped => "dropped",
                        drag::DragResult::Cancel => "cancelled",
                    };
                    let (x, y, inside) = match (
                        callback_window.cursor_position(),
                        callback_window.outer_position(),
                        callback_window.inner_size(),
                        callback_window.scale_factor(),
                    ) {
                        (Ok(cursor), Ok(origin), Ok(size), Ok(scale)) => {
                            let x = (cursor.x - origin.x as f64) / scale;
                            let y = (cursor.y - origin.y as f64) / scale;
                            let width = size.width as f64 / scale;
                            let height = size.height as f64 / scale;
                            (x, y, x >= 0.0 && y >= 0.0 && x <= width && y <= height)
                        }
                        _ => (cursor.x as f64, cursor.y as f64, false),
                    };
                    let _ = callback_window.emit(
                        "native-drag-ended",
                        NativeDragEnded {
                            result: result.to_string(),
                            x,
                            y,
                            inside,
                        },
                    );
                },
                drag::Options::default(),
            )
            .map_err(|e| e.to_string());

            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    rx.await
        .map_err(|_| "native drag task ended before AppKit started the session".to_string())?
}

fn compact_preview(path: Option<&Path>, size: u32) -> drag::Image {
    let source = path
        .and_then(|path| image::open(path).ok())
        .or_else(|| image::load_from_memory(include_bytes!("../icons/128x128.png")).ok());
    let Some(source) = source else {
        return drag::Image::Raw(include_bytes!("../icons/128x128.png").to_vec());
    };
    let thumbnail = source.thumbnail(size, size);
    let mut encoded = std::io::Cursor::new(Vec::new());
    if thumbnail
        .write_to(&mut encoded, image::ImageFormat::Png)
        .is_ok()
    {
        drag::Image::Raw(encoded.into_inner())
    } else {
        drag::Image::Raw(include_bytes!("../icons/128x128.png").to_vec())
    }
}

/// Get the temp directory for staging drag files.
fn get_temp_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("com.andresgonzalez.mac-edge-drop")
        .join("temp")
}

pub fn is_staged_drag_path(path: &Path) -> bool {
    path.starts_with(get_temp_dir())
}

/// Clean up staged temp files.
pub fn clean_temp() {
    let temp_dir = get_temp_dir();
    let _ = fs::remove_dir_all(&temp_dir);
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    #[test]
    fn native_drag_preview_is_bounded_to_the_configured_size() {
        let drag::Image::Raw(bytes) = compact_preview(None, 48) else {
            panic!("preview should be encoded in memory");
        };
        let decoded = image::load_from_memory(&bytes).unwrap();
        let (width, height) = decoded.dimensions();
        assert!(width <= 48);
        assert!(height <= 48);
    }
}
