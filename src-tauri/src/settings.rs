use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_display_id")]
    pub display_id: String,
    #[serde(default = "default_edge_position")]
    pub edge_position: String,
    #[serde(default = "default_toggle_hotkey")]
    pub toggle_hotkey: String,
    pub hot_zone_height: f64,
    pub hot_zone_width: f64,
    pub history_limit: usize,
    pub panel_height: f64,
    pub open_delay_ms: u64,
    pub close_delay_ms: u64,
    pub drag_preview_size: u32,
    #[serde(default = "default_true")]
    pub move_pasted_to_top: bool,
    #[serde(default)]
    pub clear_unpinned_on_restart: bool,
    #[serde(default)]
    pub auto_delete_hours: u64,
    pub incognito: bool,
    pub reduce_motion: bool,
    #[serde(default)]
    pub bounce_animation: bool,
    #[serde(default = "default_vertical_offset")]
    pub vertical_offset: f64,
    #[serde(default = "default_trigger_alignment")]
    pub trigger_alignment: String,
    #[serde(default = "default_true")]
    pub hover_activation: bool,
    #[serde(default = "default_true")]
    pub launch_at_login: bool,
    #[serde(default = "default_font_size_scale")]
    pub font_size_scale: f64,
    pub ui_style: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            display_id: default_display_id(),
            edge_position: default_edge_position(),
            toggle_hotkey: default_toggle_hotkey(),
            hot_zone_height: 0.25,
            hot_zone_width: 3.0,
            history_limit: 500,
            panel_height: 0.60,
            open_delay_ms: 120,
            close_delay_ms: 400,
            drag_preview_size: 72,
            move_pasted_to_top: true,
            clear_unpinned_on_restart: false,
            auto_delete_hours: 0,
            incognito: false,
            reduce_motion: false,
            bounce_animation: false,
            vertical_offset: default_vertical_offset(),
            trigger_alignment: default_trigger_alignment(),
            hover_activation: true,
            launch_at_login: true,
            font_size_scale: default_font_size_scale(),
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
        if self.display_id.trim().is_empty() || self.display_id.len() > 240 {
            self.display_id = default_display_id();
        }
        if self.edge_position != "right" {
            self.edge_position = "left".to_string();
        }
        if self.toggle_hotkey.trim().is_empty() || self.toggle_hotkey.len() > 80 {
            self.toggle_hotkey = default_toggle_hotkey();
        }
        self.hot_zone_height = self.hot_zone_height.clamp(0.10, 1.0);
        self.hot_zone_width = self.hot_zone_width.clamp(1.0, 16.0);
        self.history_limit = self.history_limit.clamp(50, 2_000);
        self.panel_height = self.panel_height.clamp(0.35, 0.95);
        self.open_delay_ms = self.open_delay_ms.clamp(60, 700);
        self.close_delay_ms = self.close_delay_ms.clamp(100, 1_500);
        self.drag_preview_size = self.drag_preview_size.clamp(40, 128);
        self.auto_delete_hours = match self.auto_delete_hours {
            1 | 6 | 24 | 168 => self.auto_delete_hours,
            _ => 0,
        };
        self.vertical_offset = self.vertical_offset.clamp(0.0, 1.0);
        if !matches!(self.trigger_alignment.as_str(), "top" | "center" | "bottom") {
            self.trigger_alignment = default_trigger_alignment();
        }
        self.font_size_scale = self.font_size_scale.clamp(0.85, 1.15);
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

fn default_edge_position() -> String {
    "left".to_string()
}

fn default_display_id() -> String {
    "primary".to_string()
}

fn default_true() -> bool {
    true
}

fn default_toggle_hotkey() -> String {
    "Alt+KeyC".to_string()
}

fn default_vertical_offset() -> f64 {
    0.5
}

fn default_trigger_alignment() -> String {
    "center".to_string()
}

fn default_font_size_scale() -> f64 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_settings_are_sanitized_to_supported_runtime_ranges() {
        let settings = AppSettings {
            display_id: String::new(),
            edge_position: "bottom".to_string(),
            toggle_hotkey: String::new(),
            hot_zone_height: 4.0,
            hot_zone_width: 0.0,
            history_limit: 3,
            panel_height: 0.1,
            open_delay_ms: 1,
            close_delay_ms: 9_000,
            drag_preview_size: 500,
            move_pasted_to_top: false,
            clear_unpinned_on_restart: true,
            auto_delete_hours: 13,
            incognito: true,
            reduce_motion: true,
            bounce_animation: true,
            vertical_offset: 4.0,
            trigger_alignment: "sideways".to_string(),
            hover_activation: false,
            launch_at_login: false,
            font_size_scale: 2.0,
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
        assert_eq!(settings.edge_position, "left");
        assert_eq!(settings.display_id, "primary");
        assert_eq!(settings.toggle_hotkey, "Alt+KeyC");
        assert_eq!(settings.auto_delete_hours, 0);
        assert_eq!(settings.vertical_offset, 1.0);
        assert_eq!(settings.trigger_alignment, "center");
        assert_eq!(settings.font_size_scale, 1.15);
    }
}
