// Types for Tauri event payloads matching the Rust backend

export interface CursorEdgePayload {
  x: number;
  y: number;
  in_edge: boolean;
  in_zone: boolean;
  stick_position: string;
  display_width: number;
  display_height: number;
}

export interface ClipboardUpdatePayload {
  items: import("./store").ClipboardItem[];
}