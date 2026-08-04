use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub hot_zone_height: f64,
    pub hot_zone_width: f64,
    pub history_limit: usize,
    pub panel_height: f64,
    pub open_delay_ms: u64,
    pub close_delay_ms: u64,
    pub drag_preview_size: u32,
    pub incognito: bool,
    pub reduce_motion: bool,
    pub ui_style: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hot_zone_height: 0.25,
            hot_zone_width: 3.0,
            history_limit: 500,
            panel_height: 0.60,
            open_delay_ms: 120,
            close_delay_ms: 400,
            drag_preview_size: 72,
            incognito: false,
            reduce_motion: false,
            ui_style: "modern".to_string(),
        }
    }
}

impl AppSettings {
    fn path() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("com.andresgonzalez.mac-edge-drop")
            .join("settings.json")
    }

    pub fn load() -> Self {
        fs::read_to_string(Self::path())
            .ok()
            .and_then(|raw| serde_json::from_str::<Self>(&raw).ok())
            .unwrap_or_default()
            .sanitized()
    }

    pub fn sanitized(mut self) -> Self {
        self.hot_zone_height = self.hot_zone_height.clamp(0.10, 1.0);
        self.hot_zone_width = self.hot_zone_width.clamp(1.0, 16.0);
        self.history_limit = self.history_limit.clamp(50, 2_000);
        self.panel_height = self.panel_height.clamp(0.35, 0.95);
        self.open_delay_ms = self.open_delay_ms.clamp(60, 700);
        self.close_delay_ms = self.close_delay_ms.clamp(100, 1_500);
        self.drag_preview_size = self.drag_preview_size.clamp(40, 128);
        if self.ui_style != "compact" {
            self.ui_style = "modern".to_string();
        }
        self
    }

    pub fn persist(&self) -> Result<(), String> {
        let path = Self::path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|error| error.to_string())?;
        fs::write(path, json).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_settings_are_sanitized_to_supported_runtime_ranges() {
        let settings = AppSettings {
            hot_zone_height: 4.0,
            hot_zone_width: 0.0,
            history_limit: 3,
            panel_height: 0.1,
            open_delay_ms: 1,
            close_delay_ms: 9_000,
            drag_preview_size: 500,
            incognito: true,
            reduce_motion: true,
            ui_style: "unknown".to_string(),
        }
        .sanitized();

        assert_eq!(settings.hot_zone_height, 1.0);
        assert_eq!(settings.hot_zone_width, 1.0);
        assert_eq!(settings.history_limit, 50);
        assert_eq!(settings.panel_height, 0.35);
        assert_eq!(settings.open_delay_ms, 60);
        assert_eq!(settings.close_delay_ms, 1_500);
        assert_eq!(settings.drag_preview_size, 128);
        assert_eq!(settings.ui_style, "modern");
    }
}
