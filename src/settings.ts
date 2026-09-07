export interface SettingsData {
  displayId: string;
  edgePosition: "left" | "right";
  toggleHotkey: string;
  hotZoneHeight: number;
  hotZoneWidth: number;
  historyLimit: number;
  panelHeight: number;
  openDelayMs: number;
  closeDelayMs: number;
  dragPreviewSize: number;
  movePastedToTop: boolean;
  clearUnpinnedOnRestart: boolean;
  autoDeleteHours: number;
  incognito: boolean;
  reduceMotion: boolean;
  bounceAnimation: boolean;
  verticalOffset: number;
  triggerAlignment: "top" | "center" | "bottom";
  hoverActivation: boolean;
  launchAtLogin: boolean;
  fontSizeScale: number;
  uiStyle: "modern" | "compact";
}

export interface DisplayOption {
  id: string;
  label: string;
  primary: boolean;
}

export const DEFAULT_SETTINGS: SettingsData = {
  displayId: "primary",
  edgePosition: "left",
  toggleHotkey: "Alt+KeyC",
  hotZoneHeight: 0.25,
  hotZoneWidth: 3,
  historyLimit: 500,
  panelHeight: 0.60,
  openDelayMs: 120,
  closeDelayMs: 400,
  dragPreviewSize: 72,
  movePastedToTop: true,
  clearUnpinnedOnRestart: false,
  autoDeleteHours: 0,
  incognito: false,
  reduceMotion: false,
  bounceAnimation: false,
  verticalOffset: 0.5,
  triggerAlignment: "center",
  hoverActivation: true,
  launchAtLogin: true,
  fontSizeScale: 1,
  uiStyle: "modern",
};
