export interface SettingsData {
  hotZoneHeight: number;
  hotZoneWidth: number;
  historyLimit: number;
  panelHeight: number;
  openDelayMs: number;
  closeDelayMs: number;
  dragPreviewSize: number;
  incognito: boolean;
  reduceMotion: boolean;
  uiStyle: "modern" | "compact";
}

export const DEFAULT_SETTINGS: SettingsData = {
  hotZoneHeight: 0.25,
  hotZoneWidth: 3,
  historyLimit: 500,
  panelHeight: 0.60,
  openDelayMs: 120,
  closeDelayMs: 400,
  dragPreviewSize: 72,
  incognito: false,
  reduceMotion: false,
  uiStyle: "modern",
};
