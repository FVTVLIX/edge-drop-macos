use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tauri::WebviewWindow;

pub const MAX_STACK: usize = 10;
const DEFAULT_HISTORY_LIMIT: usize = 500;

/// Produce a stable identifier for decoded image pixels. The sampled 64-bit
/// hash keeps clipboard polling inexpensive while dimensions and byte length
/// make accidental collisions vanishingly unlikely for shelf content.
pub fn image_content_id(width: u32, height: u32, rgba: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    let step = std::cmp::max(1, rgba.len() / 4096);
    for byte in rgba.iter().step_by(step) {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("image-{width}x{height}-{}-{hash:016x}", rgba.len())
}

/// Domain types matching the original Edge-Drop shared/types.ts
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "kind")]
pub enum ItemData {
    #[serde(rename = "text")]
    Text {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        html: Option<String>,
        #[serde(rename = "isUrl")]
        is_url: bool,
        #[serde(rename = "isColor", default)]
        is_color: bool,
    },
    #[serde(rename = "image")]
    Image {
        #[serde(rename = "imageId")]
        image_id: String,
        width: u32,
        height: u32,
        bytes: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        ext: Option<String>,
    },
    #[serde(rename = "image-collection")]
    ImageCollection { images: Vec<ImageEntry> },
    #[serde(rename = "files")]
    Files { paths: Vec<String> },
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ImageEntry {
    #[serde(rename = "imageId")]
    pub image_id: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct FileEntry {
    pub name: String,
    pub ext: String,
    pub size: u64,
    #[serde(rename = "isDirectory", default)]
    pub is_directory: bool,
    #[serde(rename = "isImage")]
    pub is_image: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

pub fn file_entries(paths: &[String]) -> Vec<FileEntry> {
    paths
        .iter()
        .filter_map(|path_string| {
            let path = std::path::Path::new(path_string);
            let name = path.file_name()?.to_string_lossy().to_string();
            let ext = path
                .extension()
                .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let metadata = fs::metadata(path).ok()?;
            let is_directory = metadata.is_dir();
            let size = if is_directory { 0 } else { metadata.len() };
            let is_image = !is_directory
                && matches!(
                    ext.as_str(),
                    "png"
                        | "jpg"
                        | "jpeg"
                        | "gif"
                        | "webp"
                        | "bmp"
                        | "tiff"
                        | "tif"
                        | "heic"
                        | "heif"
                );
            let preview = if is_image && size < 500_000 {
                fs::read(path).ok().map(|bytes| {
                    use base64::Engine as _;
                    let mime_ext = if ext == "jpg" { "jpeg" } else { ext.as_str() };
                    format!(
                        "data:image/{mime_ext};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(bytes)
                    )
                })
            } else {
                None
            };

            Some(FileEntry {
                name,
                ext,
                size,
                is_directory,
                is_image,
                preview,
            })
        })
        .collect()
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ClipboardItem {
    pub id: String,
    pub data: ItemData,
    #[serde(rename = "capturedAt")]
    pub captured_at: i64,
    #[serde(rename = "hitCount")]
    pub hit_count: u32,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<FileEntry>>,
}

/// In-memory + on-disk clipboard history store.
pub struct ItemStore {
    items: Vec<ClipboardItem>,
    sig_to_id: HashMap<String, String>,
    data_dir: PathBuf,
    window: Option<WebviewWindow>,
    history_limit: usize,
}

impl ItemStore {
    pub fn new() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("com.andresgonzalez.mac-edge-drop");

        fs::create_dir_all(&data_dir).ok();

        let mut store = Self {
            items: Vec::new(),
            sig_to_id: HashMap::new(),
            data_dir,
            window: None,
            history_limit: DEFAULT_HISTORY_LIMIT,
        };

        store.load();
        store
    }

    pub fn set_window(&mut self, window: WebviewWindow) {
        self.window = Some(window);
    }

    pub fn set_history_limit(&mut self, limit: usize) {
        self.history_limit = limit.clamp(50, 2_000);
        self.trim(self.history_limit);
        self.rebuild_index();
        self.persist();
    }

    pub fn get_window(&self) -> Option<&WebviewWindow> {
        self.window.as_ref()
    }

    fn index_path(&self) -> PathBuf {
        self.data_dir.join("index.json")
    }

    /// Compute a stable content-based signature for dedup.
    fn signature(data: &ItemData) -> String {
        match data {
            ItemData::Text { text, .. } => format!("text|{}", text),
            ItemData::Image { image_id, .. } => format!("image|{}", image_id),
            ItemData::ImageCollection { images } => {
                let ids: Vec<&str> = images.iter().map(|i| i.image_id.as_str()).collect();
                format!("image-collection|{}", ids.join(","))
            }
            ItemData::Files { paths } => format!("files|{}", paths.join("\n")),
        }
    }

    fn load(&mut self) {
        if let Ok(raw) = fs::read_to_string(self.index_path()) {
            if let Ok(items) = serde_json::from_str::<Vec<ClipboardItem>>(&raw) {
                self.items = items;
                let refreshed_files = self.refresh_file_entries();
                let normalized = self.normalize_duplicate_images();
                self.rebuild_index();
                if normalized || refreshed_files {
                    self.persist();
                }
            }
        }
    }

    /// Older indexes did not distinguish folders from extensionless files.
    /// Refresh only stale file metadata so existing folder cards acquire their
    /// native folder icon and label after upgrading.
    fn refresh_file_entries(&mut self) -> bool {
        let mut changed = false;
        for item in &mut self.items {
            let ItemData::Files { paths } = &item.data else {
                continue;
            };
            let stale = item.entries.as_ref().is_none_or(|entries| {
                entries.len() != paths.len()
                    || entries.iter().zip(paths).any(|(entry, path)| {
                        entry.is_directory != std::path::Path::new(path).is_dir()
                    })
            });
            if stale {
                item.entries = Some(file_entries(paths));
                changed = true;
            }
        }
        changed
    }

    /// Older builds assigned every clipboard poll a random image ID. If two
    /// app instances observed the same pasteboard change, identical images
    /// could therefore appear twice. Normalize those legacy entries by the
    /// PNG bytes already stored on disk.
    fn normalize_duplicate_images(&mut self) -> bool {
        let image_dir = self.data_dir.join("images");
        let fingerprint = |image_id: &str| {
            let path = image_dir.join(format!("{image_id}.png"));
            fs::read(path)
                .map(|bytes| format!("{}-{:08x}", bytes.len(), crc32fast::hash(&bytes)))
                .unwrap_or_else(|_| format!("id-{image_id}"))
        };

        let mut changed = false;
        let mut normalized: Vec<ClipboardItem> = Vec::with_capacity(self.items.len());
        let mut standalone_images: HashMap<String, usize> = HashMap::new();

        for mut item in std::mem::take(&mut self.items) {
            if let ItemData::Image {
                image_id,
                width,
                height,
                bytes,
                ext,
            } = item.data.clone()
            {
                let stable_id = stable_stored_image_id(&image_dir, &image_id);
                if stable_id != image_id {
                    changed = true;
                    item.data = ItemData::Image {
                        image_id: stable_id,
                        width,
                        height,
                        bytes,
                        ext,
                    };
                }
            }

            if let ItemData::ImageCollection { images } = item.data.clone() {
                let original_len = images.len();
                let mut seen = HashSet::new();
                let unique = images
                    .into_iter()
                    .map(|mut image| {
                        let stable_id = stable_stored_image_id(&image_dir, &image.image_id);
                        if stable_id != image.image_id {
                            changed = true;
                            image.image_id = stable_id;
                        }
                        image
                    })
                    .filter(|image| seen.insert(fingerprint(&image.image_id)))
                    .collect::<Vec<_>>();

                if unique.len() != original_len || unique.len() < 2 {
                    changed = true;
                }
                if unique.len() == 1 {
                    let image = &unique[0];
                    item.data = ItemData::Image {
                        image_id: image.image_id.clone(),
                        width: image.width,
                        height: image.height,
                        bytes: image.bytes,
                        ext: image.ext.clone(),
                    };
                } else {
                    item.data = ItemData::ImageCollection { images: unique };
                }
            }

            if let ItemData::Image { image_id, .. } = &item.data {
                let key = fingerprint(image_id);
                if let Some(existing_idx) = standalone_images.get(&key).copied() {
                    normalized[existing_idx].hit_count += item.hit_count;
                    normalized[existing_idx].pinned |= item.pinned;
                    changed = true;
                    continue;
                }
                standalone_images.insert(key, normalized.len());
            }

            normalized.push(item);
        }

        self.items = normalized;
        changed
    }

    fn persist(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&self.items) {
            let _ = fs::write(self.index_path(), json);
        }
    }

    fn rebuild_index(&mut self) {
        self.sig_to_id.clear();
        for item in &self.items {
            self.sig_to_id
                .insert(Self::signature(&item.data), item.id.clone());
        }
    }

    /// Add or refresh clipboard content. Returns true if the list changed.
    pub fn add(&mut self, data: ItemData) -> bool {
        self.add_with_entries_inner(data, None)
    }

    /// Add files with pre-computed FileEntry metadata.
    pub fn add_with_entries(&mut self, paths: Vec<String>, entries: Vec<FileEntry>) -> bool {
        self.add_with_entries_inner(ItemData::Files { paths }, Some(entries))
    }

    pub fn add_files(&mut self, paths: Vec<String>) -> bool {
        let entries = file_entries(&paths);
        self.add_with_entries(paths, entries)
    }

    fn add_with_entries_inner(&mut self, data: ItemData, entries: Option<Vec<FileEntry>>) -> bool {
        let sig = Self::signature(&data);
        let now = chrono::Utc::now().timestamp_millis();

        if let Some(existing_id) = self.sig_to_id.get(&sig) {
            if let Some(idx) = self.items.iter().position(|i| &i.id == existing_id) {
                let mut item = self.items.remove(idx);
                item.hit_count += 1;
                item.captured_at = now;
                self.items.insert(0, item);
                self.persist();
                return true;
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let item = ClipboardItem {
            id,
            data,
            captured_at: now,
            hit_count: 1,
            pinned: false,
            entries,
        };

        self.items.insert(0, item);
        self.trim(self.history_limit);
        self.rebuild_index();
        self.persist();
        true
    }

    pub fn set_pinned(&mut self, id: &str, pinned: bool) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == id) {
            item.pinned = pinned;
            self.persist();
        }
    }

    pub fn delete(&mut self, id: &str) {
        if let Some(idx) = self.items.iter().position(|i| i.id == id) {
            let removed = self.items.remove(idx);
            self.sig_to_id.remove(&Self::signature(&removed.data));
            self.persist();
        }
    }

    pub fn list(&self) -> &[ClipboardItem] {
        &self.items
    }

    fn trim(&mut self, limit: usize) {
        if self.items.len() <= limit {
            return;
        }
        let need = self.items.len() - limit;
        let mut removed = 0;
        self.items.retain(|item| {
            if removed < need && !item.pinned {
                self.sig_to_id.remove(&Self::signature(&item.data));
                removed += 1;
                false
            } else {
                true
            }
        });
    }

    /// Merge source into target. Images may merge with image collections and
    /// files may merge with file bundles; text remains deliberately ungrouped.
    pub fn merge(&mut self, source_id: &str, target_id: &str) -> Result<(), String> {
        if source_id == target_id {
            return Err("cannot merge item into itself".into());
        }
        let source = self
            .items
            .iter()
            .find(|item| item.id == source_id)
            .cloned()
            .ok_or("source not found")?;
        let target = self
            .items
            .iter()
            .find(|item| item.id == target_id)
            .cloned()
            .ok_or("target not found")?;

        let (merged_data, merged_entries) = match (&source.data, &target.data) {
            (
                ItemData::Files {
                    paths: source_paths,
                },
                ItemData::Files {
                    paths: target_paths,
                },
            ) => {
                let mut combined = target_paths.clone();
                for path in source_paths {
                    if !combined.contains(path) {
                        combined.push(path.clone());
                    }
                }
                if combined.len() > MAX_STACK {
                    return Err(format!("a stack can hold at most {MAX_STACK} files"));
                }
                let entries = file_entries(&combined);
                (ItemData::Files { paths: combined }, Some(entries))
            }
            (ItemData::Image { .. }, ItemData::Image { .. })
            | (ItemData::ImageCollection { .. }, ItemData::Image { .. })
            | (ItemData::Image { .. }, ItemData::ImageCollection { .. })
            | (ItemData::ImageCollection { .. }, ItemData::ImageCollection { .. }) => {
                let to_images = |data: &ItemData| match data {
                    ItemData::Image {
                        image_id,
                        width,
                        height,
                        bytes,
                        ext,
                    } => vec![ImageEntry {
                        image_id: image_id.clone(),
                        width: *width,
                        height: *height,
                        bytes: *bytes,
                        ext: ext.clone(),
                    }],
                    ItemData::ImageCollection { images } => images.clone(),
                    _ => Vec::new(),
                };
                let mut combined = to_images(&target.data);
                for image in to_images(&source.data) {
                    if !combined
                        .iter()
                        .any(|existing| existing.image_id == image.image_id)
                    {
                        combined.push(image);
                    }
                }
                if combined.len() > MAX_STACK {
                    return Err(format!("a stack can hold at most {MAX_STACK} images"));
                }
                (ItemData::ImageCollection { images: combined }, None)
            }
            _ => return Err("only images can merge with images, and files with files".into()),
        };

        self.items.retain(|item| item.id != source_id);
        let target = self
            .items
            .iter_mut()
            .find(|item| item.id == target_id)
            .ok_or("target disappeared during merge")?;
        target.data = merged_data;
        target.entries = merged_entries;
        target.captured_at = chrono::Utc::now().timestamp_millis();
        target.pinned |= source.pinned;
        self.rebuild_index();
        self.persist();
        Ok(())
    }

    /// Split a sub-item out of a bundle.
    pub fn split(
        &mut self,
        id: &str,
        image_id: Option<&str>,
        split_paths_opt: Option<&Vec<String>>,
    ) -> Result<(), String> {
        let idx = self
            .items
            .iter()
            .position(|i| i.id == id)
            .ok_or("item not found")?;
        let source = self.items[idx].clone();

        let new_item = match &source.data {
            ItemData::ImageCollection { images } => {
                if let Some(iid) = image_id {
                    if let Some(pos) = images.iter().position(|img| img.image_id == iid) {
                        let image = images[pos].clone();
                        let remaining: Vec<ImageEntry> = images
                            .iter()
                            .filter(|entry| entry.image_id != iid)
                            .cloned()
                            .collect();
                        let new_item = ClipboardItem {
                            id: uuid::Uuid::new_v4().to_string(),
                            data: ItemData::Image {
                                image_id: image.image_id,
                                width: image.width,
                                height: image.height,
                                bytes: image.bytes,
                                ext: image.ext,
                            },
                            captured_at: chrono::Utc::now().timestamp_millis(),
                            hit_count: 1,
                            pinned: false,
                            entries: None,
                        };
                        if remaining.len() == 1 {
                            let image = &remaining[0];
                            self.items[idx].data = ItemData::Image {
                                image_id: image.image_id.clone(),
                                width: image.width,
                                height: image.height,
                                bytes: image.bytes,
                                ext: image.ext.clone(),
                            };
                        } else {
                            self.items[idx].data = ItemData::ImageCollection { images: remaining };
                        }
                        new_item
                    } else {
                        return Err("image not found in stack".into());
                    }
                } else {
                    return Err("no image selected".into());
                }
            }
            ItemData::Files { paths } => {
                if let Some(split_paths) = split_paths_opt {
                    let selected: Vec<String> = paths
                        .iter()
                        .filter(|path| split_paths.contains(path))
                        .cloned()
                        .collect();
                    if selected.is_empty() {
                        return Err("file not found in stack".into());
                    }
                    let remaining: Vec<String> = paths
                        .iter()
                        .filter(|p| !split_paths.contains(p))
                        .cloned()
                        .collect();
                    self.items[idx].data = ItemData::Files {
                        paths: remaining.clone(),
                    };
                    self.items[idx].entries = Some(file_entries(&remaining));
                    ClipboardItem {
                        id: uuid::Uuid::new_v4().to_string(),
                        data: ItemData::Files {
                            paths: selected.clone(),
                        },
                        captured_at: chrono::Utc::now().timestamp_millis(),
                        hit_count: 1,
                        pinned: false,
                        entries: Some(file_entries(&selected)),
                    }
                } else {
                    return Err("no file selected".into());
                }
            }
            _ => return Err("cannot split non-bundle item".into()),
        };

        self.items.insert(idx + 1, new_item);
        self.rebuild_index();
        self.persist();
        Ok(())
    }
}

fn stable_stored_image_id(image_dir: &std::path::Path, image_id: &str) -> String {
    let source = image_dir.join(format!("{image_id}.png"));
    let Ok(decoded) = image::open(&source) else {
        return image_id.to_string();
    };
    let rgba = decoded.to_rgba8();
    let stable_id = image_content_id(decoded.width(), decoded.height(), rgba.as_raw());
    if stable_id != image_id {
        let destination = image_dir.join(format!("{stable_id}.png"));
        if !destination.exists() && fs::copy(source, destination).is_err() {
            return image_id.to_string();
        }
    }
    stable_id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> ItemStore {
        let data_dir =
            std::env::temp_dir().join(format!("mac-edge-drop-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&data_dir).unwrap();
        ItemStore {
            items: Vec::new(),
            sig_to_id: HashMap::new(),
            data_dir,
            window: None,
            history_limit: DEFAULT_HISTORY_LIMIT,
        }
    }

    fn image(image_id: &str) -> ItemData {
        ItemData::Image {
            image_id: image_id.to_string(),
            width: 100,
            height: 80,
            bytes: 320,
            ext: Some("png".to_string()),
        }
    }

    #[test]
    fn image_items_merge_and_split_without_losing_members() {
        let mut store = test_store();
        store.add(image("first"));
        store.add(image("second"));
        let source_id = store.items[0].id.clone();
        let target_id = store.items[1].id.clone();

        store.merge(&source_id, &target_id).unwrap();
        assert_eq!(store.items.len(), 1);
        match &store.items[0].data {
            ItemData::ImageCollection { images } => assert_eq!(images.len(), 2),
            _ => panic!("images should merge into a collection"),
        }

        store.split(&target_id, Some("second"), None).unwrap();
        assert_eq!(store.items.len(), 2);
        assert!(store
            .items
            .iter()
            .all(|item| matches!(item.data, ItemData::Image { .. })));
        let _ = fs::remove_dir_all(&store.data_dir);
    }

    #[test]
    fn file_stacks_merge_and_selected_paths_split_back_out() {
        let mut store = test_store();
        store.add_files(vec!["/tmp/one.txt".to_string()]);
        store.add_files(vec!["/tmp/two.txt".to_string()]);
        let source_id = store.items[0].id.clone();
        let target_id = store.items[1].id.clone();

        store.merge(&source_id, &target_id).unwrap();
        match &store.items[0].data {
            ItemData::Files { paths } => assert_eq!(paths.len(), 2),
            _ => panic!("files should merge into a file stack"),
        }

        store
            .split(&target_id, None, Some(&vec!["/tmp/two.txt".to_string()]))
            .unwrap();
        assert_eq!(store.items.len(), 2);
        assert!(store
            .items
            .iter()
            .all(|item| { matches!(&item.data, ItemData::Files { paths } if paths.len() == 1) }));
        let _ = fs::remove_dir_all(&store.data_dir);
    }

    #[test]
    fn finder_folders_are_distinguished_from_extensionless_files() {
        let root =
            std::env::temp_dir().join(format!("edge-drop-folder-test-{}", uuid::Uuid::new_v4()));
        let folder = root.join("Project Assets");
        let file = root.join("LICENSE");
        fs::create_dir_all(&folder).unwrap();
        fs::write(&file, b"license").unwrap();

        let entries = file_entries(&[
            folder.to_string_lossy().to_string(),
            file.to_string_lossy().to_string(),
        ]);

        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_directory);
        assert_eq!(entries[0].size, 0);
        assert!(!entries[0].is_image);
        assert!(!entries[1].is_directory);
        assert_eq!(entries[1].size, 7);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stack_capacity_is_enforced_before_mutating_items() {
        let mut store = test_store();
        let full = (0..MAX_STACK)
            .map(|index| format!("/tmp/{index}.txt"))
            .collect::<Vec<_>>();
        store.add_files(full);
        store.add_files(vec!["/tmp/overflow.txt".to_string()]);
        let source_id = store.items[0].id.clone();
        let target_id = store.items[1].id.clone();

        assert!(store.merge(&source_id, &target_id).is_err());
        assert_eq!(store.items.len(), 2);
        let _ = fs::remove_dir_all(&store.data_dir);
    }

    #[test]
    fn stable_image_ids_and_legacy_cleanup_prevent_duplicate_captures() {
        let pixels = vec![12, 34, 56, 255, 78, 90, 12, 255];
        assert_eq!(
            image_content_id(2, 1, &pixels),
            image_content_id(2, 1, &pixels)
        );
        assert_ne!(
            image_content_id(2, 1, &pixels),
            image_content_id(1, 2, &pixels)
        );

        let mut store = test_store();
        let image_dir = store.data_dir.join("images");
        fs::create_dir_all(&image_dir).unwrap();
        fs::write(image_dir.join("legacy-one.png"), b"identical png bytes").unwrap();
        fs::write(image_dir.join("legacy-two.png"), b"identical png bytes").unwrap();
        store.items.push(ClipboardItem {
            id: "collection".to_string(),
            data: ItemData::ImageCollection {
                images: vec![
                    ImageEntry {
                        image_id: "legacy-one".to_string(),
                        width: 100,
                        height: 100,
                        bytes: 64,
                        ext: Some("png".to_string()),
                    },
                    ImageEntry {
                        image_id: "legacy-two".to_string(),
                        width: 100,
                        height: 100,
                        bytes: 64,
                        ext: Some("png".to_string()),
                    },
                ],
            },
            captured_at: 1,
            hit_count: 1,
            pinned: false,
            entries: None,
        });

        assert!(store.normalize_duplicate_images());
        assert_eq!(store.items.len(), 1);
        assert!(matches!(store.items[0].data, ItemData::Image { .. }));
        let _ = fs::remove_dir_all(&store.data_dir);
    }
}
