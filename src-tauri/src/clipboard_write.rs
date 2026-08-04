use std::path::{Path, PathBuf};

use crate::drag::DragRequest;
use crate::store::{ClipboardItem, ItemData};

#[derive(Debug)]
enum CopyPayload {
    Text { text: String, html: Option<String> },
    Files(Vec<PathBuf>),
    Images(Vec<PathBuf>),
}

pub fn write_item(item: &ClipboardItem, request: &DragRequest) -> Result<(), String> {
    match resolve_payload(item, request)? {
        CopyPayload::Text { text, html } => write_text(text, html),
        CopyPayload::Files(paths) => write_files(&paths),
        CopyPayload::Images(paths) => write_images(&paths),
    }
}

fn resolve_payload(item: &ClipboardItem, request: &DragRequest) -> Result<CopyPayload, String> {
    match &item.data {
        ItemData::Text { text, html, .. } => {
            if request.image_id.is_some() || request.paths.is_some() {
                return Err("text items do not contain stack members".to_string());
            }
            Ok(CopyPayload::Text {
                text: text.clone(),
                html: html.clone(),
            })
        }
        ItemData::Image { image_id, .. } => {
            if request.image_id.as_deref().is_some_and(|id| id != image_id) {
                return Err("image is not part of this item".to_string());
            }
            Ok(CopyPayload::Images(validate_paths(vec![image_path(
                image_id,
            )])?))
        }
        ItemData::ImageCollection { images } => {
            let paths = if let Some(image_id) = request.image_id.as_deref() {
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
            };
            Ok(CopyPayload::Images(validate_paths(paths)?))
        }
        ItemData::Files { paths } => {
            let selected = if let Some(selected) = request.paths.as_ref() {
                if selected.is_empty() || selected.iter().any(|path| !paths.contains(path)) {
                    return Err("file is not part of this stack".to_string());
                }
                selected.clone()
            } else {
                paths.clone()
            };
            Ok(CopyPayload::Files(validate_paths(
                selected.into_iter().map(PathBuf::from).collect(),
            )?))
        }
    }
}

fn validate_paths(paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() {
        return Err("item has no content to copy".to_string());
    }

    let mut validated = Vec::with_capacity(paths.len());
    for path in paths {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("cannot copy missing item {}: {error}", path.display()))?;
        if !validated.contains(&canonical) {
            validated.push(canonical);
        }
    }
    Ok(validated)
}

fn image_path(image_id: &str) -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.andresgonzalez.mac-edge-drop")
        .join("images")
        .join(format!("{image_id}.png"))
}

fn write_text(text: String, html: Option<String>) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    if let Some(html) = html.filter(|html| !html.trim().is_empty()) {
        clipboard
            .set()
            .html(html, Some(text))
            .map_err(|error| error.to_string())
    } else {
        clipboard.set_text(text).map_err(|error| error.to_string())
    }
}

fn write_files(paths: &[PathBuf]) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard
        .set()
        .file_list(paths)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn write_images(paths: &[PathBuf]) -> Result<(), String> {
    let pasteboard = objc2_app_kit::NSPasteboard::generalPasteboard();
    write_images_to_pasteboard(paths, &pasteboard)
}

#[cfg(target_os = "macos")]
fn write_images_to_pasteboard(
    paths: &[PathBuf],
    pasteboard: &objc2_app_kit::NSPasteboard,
) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSPasteboardItem, NSPasteboardTypeFileURL, NSPasteboardTypePNG, NSPasteboardWriting,
    };
    use objc2_foundation::{NSArray, NSData};

    let first_path = paths
        .first()
        .ok_or_else(|| "item has no images to copy".to_string())?;
    let png = std::fs::read(first_path)
        .map_err(|error| format!("cannot read image {}: {error}", first_path.display()))?;

    let first_item = NSPasteboardItem::new();
    if !first_item.setData_forType(&NSData::with_bytes(&png), unsafe { NSPasteboardTypePNG }) {
        return Err("macOS rejected the image clipboard data".to_string());
    }
    let first_url = file_url(first_path)?;
    let first_url_string = first_url
        .absoluteString()
        .ok_or_else(|| "macOS could not encode the image file URL".to_string())?;
    if !first_item.setString_forType(&first_url_string, unsafe { NSPasteboardTypeFileURL }) {
        return Err("macOS rejected the image file reference".to_string());
    }

    let mut objects = vec![ProtocolObject::<dyn NSPasteboardWriting>::from_retained(
        first_item,
    )];
    for path in paths.iter().skip(1) {
        objects.push(ProtocolObject::<dyn NSPasteboardWriting>::from_retained(
            file_url(path)?,
        ));
    }

    pasteboard.clearContents();
    let objects = NSArray::from_retained_slice(&objects);
    let result = if pasteboard.writeObjects(&objects) {
        Ok(())
    } else {
        Err("macOS could not write the images to the clipboard".to_string())
    };

    result
}

#[cfg(target_os = "macos")]
fn file_url(path: &Path) -> Result<objc2::rc::Retained<objc2_foundation::NSURL>, String> {
    use objc2_foundation::{NSString, NSURL};

    let path = path
        .to_str()
        .ok_or_else(|| format!("path is not valid Unicode: {}", path.display()))?;
    Ok(NSURL::fileURLWithPath(&NSString::from_str(path)))
}

#[cfg(not(target_os = "macos"))]
fn write_images(paths: &[PathBuf]) -> Result<(), String> {
    let first = paths
        .first()
        .ok_or_else(|| "item has no images to copy".to_string())?;
    if paths.len() > 1 {
        return write_files(paths);
    }

    let image = image::open(first)
        .map_err(|error| format!("cannot decode image {}: {error}", first.display()))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: image.into_raw().into(),
        })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::ImageEntry;

    fn item(data: ItemData) -> ClipboardItem {
        ClipboardItem {
            id: "item-1".to_string(),
            data,
            captured_at: 0,
            hit_count: 1,
            pinned: false,
            entries: None,
        }
    }

    #[test]
    fn rejects_file_selection_outside_stack() {
        let item = item(ItemData::Files {
            paths: vec!["/tmp/allowed".to_string()],
        });
        let request = DragRequest {
            id: item.id.clone(),
            paths: Some(vec!["/tmp/not-allowed".to_string()]),
            image_id: None,
        };
        assert!(resolve_payload(&item, &request)
            .unwrap_err()
            .contains("not part of this stack"));
    }

    #[test]
    fn rejects_image_selection_outside_stack() {
        let item = item(ItemData::ImageCollection {
            images: vec![ImageEntry {
                image_id: "known".to_string(),
                width: 10,
                height: 10,
                bytes: 100,
                ext: Some("png".to_string()),
            }],
        });
        let request = DragRequest {
            id: item.id.clone(),
            paths: None,
            image_id: Some("unknown".to_string()),
        };
        assert!(resolve_payload(&item, &request)
            .unwrap_err()
            .contains("not part of this stack"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_image_copy_contains_pixels_and_a_finder_file_reference() {
        use objc2::{msg_send, rc::Retained, ClassType};
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypePNG};

        let path =
            std::env::temp_dir().join(format!("edge-drop-copy-test-{}.png", uuid::Uuid::new_v4()));
        let png_marker = b"edge-drop-png-marker";
        std::fs::write(&path, png_marker).unwrap();

        let Some(pasteboard): Option<Retained<NSPasteboard>> =
            (unsafe { msg_send![NSPasteboard::class(), pasteboardWithUniqueName] })
        else {
            // Some headless CI sessions do not have a pasteboard server.
            std::fs::remove_file(path).unwrap();
            return;
        };
        write_images_to_pasteboard(std::slice::from_ref(&path), &pasteboard).unwrap();

        let items = pasteboard.pasteboardItems().expect("pasteboard items");
        assert_eq!(items.count(), 1);
        let first = items.firstObject().expect("first pasteboard item");
        let png = first
            .dataForType(unsafe { NSPasteboardTypePNG })
            .expect("PNG representation");
        assert_eq!(png.len(), png_marker.len());
        let file_reference = first
            .stringForType(unsafe { NSPasteboardTypeFileURL })
            .expect("file URL representation")
            .to_string();
        assert!(file_reference.starts_with("file://"));

        std::fs::remove_file(path).unwrap();
    }
}
