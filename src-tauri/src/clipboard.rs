use crate::store::{ClipboardItem, ItemData, MAX_STACK};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;

const PASTEBOARD_STABILITY_MS: u64 = 250;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ClipboardUpdate {
    pub items: Vec<ClipboardItem>,
}

pub struct ClipboardWatcher {
    pub interval_ms: u64,
    pub paused: bool,
    pub baseline_pending: bool,
    self_write_in_progress: bool,
    last_change_count: i64,
    last_signature: Option<String>,
    pending_change_count: Option<i64>,
    pending_since: Option<Instant>,
}

impl ClipboardWatcher {
    pub fn new(interval_ms: u64) -> Self {
        Self {
            interval_ms,
            paused: false,
            baseline_pending: false,
            self_write_in_progress: false,
            last_change_count: pasteboard_change_count(),
            last_signature: None,
            pending_change_count: None,
            pending_since: None,
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        if self.paused && !paused {
            self.baseline_pending = true;
        }
        self.paused = paused;
        if paused {
            self.pending_change_count = None;
            self.pending_since = None;
        }
    }

    /// Prevent a clipboard write initiated by Edge-Drop from being captured as
    /// a new history item. The watcher rebaselines once the write completes.
    pub fn begin_self_write(&mut self) {
        self.self_write_in_progress = true;
        self.pending_change_count = None;
        self.pending_since = None;
    }

    pub fn finish_self_write(&mut self) {
        self.self_write_in_progress = false;
        self.baseline_pending = true;
    }

    /// After click-to-paste, accept a genuine re-copy of the same payload as a
    /// new clipboard event even though its content signature is unchanged.
    pub fn invalidate_after_paste(&mut self) {
        self.self_write_in_progress = false;
        self.baseline_pending = false;
        self.last_change_count = pasteboard_change_count();
        self.last_signature = Some("__post-paste__".to_string());
        self.pending_change_count = None;
        self.pending_since = None;
    }

    fn set_baseline(&mut self, change_count: i64, signature: Option<String>) {
        self.last_change_count = change_count;
        self.last_signature = signature;
        self.pending_change_count = None;
        self.pending_since = None;
    }

    fn should_read_change(&mut self, change_count: i64, now: Instant) -> bool {
        if change_count == self.last_change_count {
            self.pending_change_count = None;
            self.pending_since = None;
            return false;
        }

        if self.pending_change_count != Some(change_count) {
            self.pending_change_count = Some(change_count);
            self.pending_since = Some(now);
            return false;
        }

        self.pending_since.is_some_and(|started| {
            now.duration_since(started).as_millis() >= PASTEBOARD_STABILITY_MS as u128
        })
    }
}

enum ClipboardSnapshot {
    Sensitive,
    Empty,
    Files(Vec<String>),
    Text {
        text: String,
        html: Option<String>,
        is_url: bool,
        is_color: bool,
    },
    Image {
        image_id: String,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    },
}

impl ClipboardSnapshot {
    fn signature(&self) -> Option<String> {
        match self {
            Self::Sensitive => None,
            Self::Empty => Some("empty".to_string()),
            Self::Files(paths) => {
                let mut normalized = paths.clone();
                normalized.sort();
                Some(format!("files|{}", normalized.join("\n")))
            }
            Self::Text { text, .. } => Some(format!("text|{text}")),
            Self::Image { image_id, .. } => Some(format!("image|{image_id}")),
        }
    }
}

pub async fn watch_clipboard(state: Arc<AppState>) {
    let mut clip = match arboard::Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(error) => {
            eprintln!("[clipboard] Failed to init: {error}");
            return;
        }
    };

    // Establish a launch baseline without adding the content that was already
    // on the pasteboard. Incognito mode does not inspect clipboard contents.
    let paused = state.clipboard_watcher.lock().await.paused;
    if !paused {
        let snapshot = read_snapshot(&mut clip);
        let signature = snapshot.signature();
        let change_count = pasteboard_change_count();
        state
            .clipboard_watcher
            .lock()
            .await
            .set_baseline(change_count, signature);
    }

    loop {
        if *state.quitting.lock().await {
            break;
        }

        let (paused, should_rebaseline, interval_ms) = {
            let mut watcher = state.clipboard_watcher.lock().await;
            let rebaseline = std::mem::take(&mut watcher.baseline_pending);
            (
                watcher.paused || watcher.self_write_in_progress,
                rebaseline,
                watcher.interval_ms,
            )
        };

        if paused {
            tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
            continue;
        }

        if should_rebaseline {
            let snapshot = read_snapshot(&mut clip);
            let signature = snapshot.signature();
            let change_count = pasteboard_change_count();
            state
                .clipboard_watcher
                .lock()
                .await
                .set_baseline(change_count, signature);
            continue;
        }

        let observed_change_count = pasteboard_change_count();
        let ready = state
            .clipboard_watcher
            .lock()
            .await
            .should_read_change(observed_change_count, Instant::now());

        if ready {
            let snapshot = read_snapshot(&mut clip);

            // The pasteboard changed while it was being decoded. Discard this
            // intermediate representation and wait for the new value to settle.
            let confirmed_change_count = pasteboard_change_count();
            if confirmed_change_count != observed_change_count {
                let mut watcher = state.clipboard_watcher.lock().await;
                watcher.pending_change_count = Some(confirmed_change_count);
                watcher.pending_since = Some(Instant::now());
                tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
                continue;
            }

            let signature = snapshot.signature();
            let self_copy_pending = {
                let watcher = state.clipboard_watcher.lock().await;
                watcher.self_write_in_progress || watcher.baseline_pending
            };

            if self_copy_pending {
                let mut watcher = state.clipboard_watcher.lock().await;
                watcher.baseline_pending = false;
                watcher.set_baseline(confirmed_change_count, signature);
                tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
                continue;
            }

            let is_new = {
                let watcher = state.clipboard_watcher.lock().await;
                signature.is_some() && signature != watcher.last_signature
            };

            if is_new {
                capture_snapshot(&state, snapshot).await;
            }

            let mut watcher = state.clipboard_watcher.lock().await;
            watcher.last_change_count = confirmed_change_count;
            // Sensitive content is ignored without replacing the previous safe
            // signature, so a password manager restoring the clipboard does not
            // create a duplicate shelf entry.
            if signature.is_some() {
                watcher.last_signature = signature;
            }
            watcher.pending_change_count = None;
            watcher.pending_since = None;
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
    }
}

fn read_snapshot(clip: &mut arboard::Clipboard) -> ClipboardSnapshot {
    if pasteboard_types()
        .iter()
        .any(|kind| is_sensitive_type(kind))
    {
        return ClipboardSnapshot::Sensitive;
    }

    let files = clip
        .get()
        .file_list()
        .unwrap_or_default()
        .into_iter()
        .filter_map(normalize_file_path)
        .fold(Vec::new(), |mut unique, path| {
            if !unique.contains(&path) {
                unique.push(path);
            }
            unique
        });
    if !files.is_empty() {
        return ClipboardSnapshot::Files(files);
    }

    let text = clip
        .get()
        .text()
        .unwrap_or_default()
        .trim_matches(['\r', '\n'])
        .to_string();
    let html = clip
        .get()
        .html()
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != &text);
    let image = clip.get().image().ok();
    let is_url = looks_like_url(&text);
    let is_color = looks_like_color(&text);
    let image_fallback_text = (is_url && text.len() < 500) || is_bare_image_tag(&text);
    let prefer_image = image.is_some() && (text.is_empty() || image_fallback_text);

    if prefer_image {
        return image_snapshot(image.expect("image checked above"));
    }

    if !text.is_empty() {
        return ClipboardSnapshot::Text {
            text,
            html,
            is_url,
            is_color,
        };
    }

    image
        .map(image_snapshot)
        .unwrap_or(ClipboardSnapshot::Empty)
}

fn image_snapshot(image: arboard::ImageData<'static>) -> ClipboardSnapshot {
    let width = image.width as u32;
    let height = image.height as u32;
    let rgba = image.bytes.into_owned();
    let image_id = crate::store::image_content_id(width, height, &rgba);
    ClipboardSnapshot::Image {
        image_id,
        width,
        height,
        rgba,
    }
}

async fn capture_snapshot(state: &Arc<AppState>, snapshot: ClipboardSnapshot) {
    let mut store = state.item_store.lock().await;
    let changed = match snapshot {
        ClipboardSnapshot::Files(paths) => {
            let mut changed = false;
            for chunk in paths.chunks(MAX_STACK) {
                changed |= store.add_files(chunk.to_vec());
            }
            changed
        }
        ClipboardSnapshot::Text {
            text,
            html,
            is_url,
            is_color,
        } => store.add(ItemData::Text {
            text,
            html,
            is_url,
            is_color,
        }),
        ClipboardSnapshot::Image {
            image_id,
            width,
            height,
            rgba,
        } => {
            let image_dir = dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("com.andresgonzalez.mac-edge-drop")
                .join("images");
            let image_path = image_dir.join(format!("{image_id}.png"));
            let saved = std::fs::create_dir_all(&image_dir)
                .and_then(|_| {
                    if image_path.exists() {
                        Ok(())
                    } else {
                        encode_png(width, height, &rgba)
                            .map_err(std::io::Error::other)
                            .and_then(|png| std::fs::write(&image_path, png))
                    }
                })
                .map_err(|error| eprintln!("[clipboard] Failed to save image: {error}"))
                .is_ok();

            saved
                && store.add(ItemData::Image {
                    image_id,
                    width,
                    height,
                    bytes: rgba.len() as u64,
                    ext: Some("png".to_string()),
                })
        }
        ClipboardSnapshot::Sensitive | ClipboardSnapshot::Empty => false,
    };

    if changed {
        let items = store.list().to_vec();
        if let Some(window) = store.get_window() {
            let _ = window.emit("clipboard-update", ClipboardUpdate { items });
        }
    }
}

fn normalize_file_path(path: PathBuf) -> Option<String> {
    if crate::drag::is_staged_drag_path(&path) || !path.exists() {
        return None;
    }
    Some(
        path.canonicalize()
            .unwrap_or(path)
            .to_string_lossy()
            .to_string(),
    )
}

fn looks_like_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("www."))
        && !value.chars().any(char::is_whitespace)
}

fn is_bare_image_tag(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("<img")
        && lower.ends_with('>')
        && !lower[4..lower.len().saturating_sub(1)].contains('<')
}

fn looks_like_color(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 6 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_sensitive_type(kind: &str) -> bool {
    let kind = kind.to_ascii_lowercase();
    [
        "org.nspasteboard.concealedtype",
        "org.nspasteboard.autogeneratedtype",
        "com.agilebits.onepassword",
        "com.apple.is-sensitive",
        "com.apple.pasteboard.concealed",
        "com.bitwarden.concealed",
        "keepassclipformat",
    ]
    .iter()
    .any(|sensitive| kind == *sensitive || kind.starts_with(&format!("{sensitive}.")))
}

#[cfg(target_os = "macos")]
fn pasteboard_change_count() -> i64 {
    use objc2::{msg_send, rc::Retained, ClassType};
    use objc2_app_kit::NSPasteboard;

    let pasteboard: Option<Retained<NSPasteboard>> =
        unsafe { msg_send![NSPasteboard::class(), generalPasteboard] };
    pasteboard
        .map(|pasteboard| pasteboard.changeCount() as i64)
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn pasteboard_change_count() -> i64 {
    0
}

#[cfg(target_os = "macos")]
fn pasteboard_types() -> Vec<String> {
    use objc2::{msg_send, rc::Retained, ClassType};
    use objc2_app_kit::NSPasteboard;

    let pasteboard: Option<Retained<NSPasteboard>> =
        unsafe { msg_send![NSPasteboard::class(), generalPasteboard] };
    pasteboard
        .and_then(|pasteboard| pasteboard.types())
        .map(|types| types.iter().map(|kind| kind.to_string()).collect())
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
fn pasteboard_types() -> Vec<String> {
    Vec::new()
}

/// Minimal PNG encoder — encodes RGBA pixels to PNG format.
fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    let mut ihdr_data = Vec::new();
    ihdr_data.extend_from_slice(&width.to_be_bytes());
    ihdr_data.extend_from_slice(&height.to_be_bytes());
    ihdr_data.push(8);
    ihdr_data.push(6);
    ihdr_data.push(0);
    ihdr_data.push(0);
    ihdr_data.push(0);
    write_png_chunk(&mut png, b"IHDR", &ihdr_data);

    let row_size = (width * 4) as usize;
    let mut raw = Vec::with_capacity((height as usize) * (1 + row_size));
    for row in 0..height as usize {
        raw.push(0);
        let start = row * row_size;
        let end = std::cmp::min(start + row_size, rgba.len());
        if start < rgba.len() {
            raw.extend_from_slice(&rgba[start..end]);
        }
        while raw.len() % (1 + row_size) != 0 {
            raw.push(0);
        }
    }

    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);
    write_png_chunk(&mut png, b"IDAT", &compressed);
    write_png_chunk(&mut png, b"IEND", &[]);
    Ok(png)
}

fn write_png_chunk(png: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    png.extend_from_slice(&(data.len() as u32).to_be_bytes());
    png.extend_from_slice(chunk_type);
    png.extend_from_slice(data);
    let mut crc = crc32fast::Hasher::new();
    crc.update(chunk_type);
    crc.update(data);
    png.extend_from_slice(&crc.finalize().to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn waits_for_a_stable_pasteboard_change() {
        let mut watcher = ClipboardWatcher::new(100);
        watcher.last_change_count = 4;
        let started = Instant::now();

        assert!(!watcher.should_read_change(5, started));
        assert!(!watcher.should_read_change(6, started + Duration::from_millis(200)));
        assert!(!watcher.should_read_change(6, started + Duration::from_millis(449)));
        assert!(watcher.should_read_change(6, started + Duration::from_millis(450)));
    }

    #[test]
    fn recognizes_private_clipboard_types() {
        assert!(is_sensitive_type("org.nspasteboard.ConcealedType"));
        assert!(is_sensitive_type("com.agilebits.onepassword.metadata"));
        assert!(is_sensitive_type("com.bitwarden.concealed"));
        assert!(!is_sensitive_type("public.utf8-plain-text"));
    }

    #[test]
    fn recognizes_urls_and_hex_colors() {
        assert!(looks_like_url("HTTPS://example.com/image.png"));
        assert!(looks_like_url("www.example.com"));
        assert!(!looks_like_url("example.com"));
        assert!(looks_like_color("#1a2B3c"));
        assert!(looks_like_color("#fff"));
        assert!(!looks_like_color("#fff8"));
        assert!(!looks_like_color("#12xz"));
        assert!(is_bare_image_tag("<IMG src=\"preview.png\">"));
        assert!(!is_bare_image_tag("caption <img src=\"preview.png\">"));
    }
}
