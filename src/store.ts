import { create } from "zustand";
import type { TypeFilter } from "./lib/filterItems";

export interface ClipboardItem {
  id: string;
  data: ItemData;
  capturedAt: number;
  hitCount: number;
  pinned: boolean;
  entries?: FileEntry[];
}

export type ItemData =
  | { kind: "text"; text: string; html?: string; isUrl: boolean; isColor?: boolean }
  | { kind: "image"; imageId: string; width: number; height: number; bytes: number; preview?: string; ext?: string }
  | { kind: "image-collection"; images: ImageEntry[] }
  | { kind: "files"; paths: string[]; entries?: FileEntry[] };

export interface ImageEntry {
  imageId: string; width: number; height: number;
  bytes: number; preview?: string; ext?: string;
}

export interface FileEntry {
  name: string; ext: string; size: number;
  isDirectory?: boolean; isImage: boolean; preview?: string;
}

export interface DragRequest {
  id: string;
  imageId?: string;
  paths?: string[];
}

export interface ToastMessage {
  id: string;
  message: string;
  tone: "info" | "error";
}

interface AppState {
  items: ClipboardItem[];
  setItems: (items: ClipboardItem[]) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  cursorPos: { x: number; y: number; inEdge: boolean };
  setCursorPos: (x: number, y: number, inEdge: boolean) => void;
  dragActive: boolean;
  setDragActive: (active: boolean) => void;
  query: string;
  setQuery: (q: string) => void;
  typeFilter: TypeFilter;
  setTypeFilter: (filter: TypeFilter) => void;
  internalDragReq: DragRequest | null;
  setInternalDragReq: (req: DragRequest | null) => void;
  previewItemId: string | null;
  previewItemRect: DOMRect | null;
  openPreview: (id: string, rect: DOMRect) => void;
  closePreview: () => void;
  toasts: ToastMessage[];
  pushToast: (message: string, tone?: ToastMessage["tone"]) => void;
  dismissToast: (id: string) => void;
  togglePin: (id: string, pinned: boolean) => void;
  deleteItem: (id: string) => void;
  deleteItems: (ids: string[]) => Promise<void>;
  clearItems: (ids?: string[]) => Promise<void>;
  mergeItems: (sourceId: string, targetId: string) => Promise<void>;
  splitItem: (id: string, imageId?: string, paths?: string[]) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  items: [],
  setItems: (items) => set({ items }),
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
  cursorPos: { x: 0, y: 0, inEdge: false },
  setCursorPos: (x, y, inEdge) => set({ cursorPos: { x, y, inEdge } }),
  dragActive: false,
  setDragActive: (active) => set({ dragActive: active }),
  query: "",
  setQuery: (q) => set({ query: q }),
  typeFilter: "all",
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  internalDragReq: null,
  setInternalDragReq: (req) => set({ internalDragReq: req }),
  previewItemId: null,
  previewItemRect: null,
  openPreview: (id, rect) => set({ previewItemId: id, previewItemRect: rect }),
  closePreview: () => set({ previewItemId: null, previewItemRect: null }),
  toasts: [],
  pushToast: (message, tone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, tone === "error" ? 3600 : 2600);
  },
  dismissToast: (id) => set((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== id),
  })),
  togglePin: (id, pinned) => {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("toggle_pin", { id, pinned })
    );
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, pinned } : i)),
    }));
  },
  deleteItem: (id) => {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("delete_item", { id })
    );
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
    }));
  },
  deleteItems: async (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    let previous: ClipboardItem[] = [];
    set((state) => {
      previous = state.items;
      return { items: state.items.filter((item) => !idSet.has(item.id)) };
    });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_items", { ids });
    } catch (error) {
      set({ items: previous });
      throw error;
    }
  },
  clearItems: async (ids) => {
    if (ids) {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      let previous: ClipboardItem[] = [];
      set((state) => {
        previous = state.items;
        return { items: state.items.filter((item) => !idSet.has(item.id)) };
      });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_items", { ids });
      } catch (error) {
        set({ items: previous });
        throw error;
      }
      return;
    }
    let previous: ClipboardItem[] = [];
    set((state) => {
      previous = state.items;
      return { items: state.items.filter((item) => item.pinned) };
    });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_items");
    } catch (error) {
      set({ items: previous });
      throw error;
    }
  },
  mergeItems: async (sourceId, targetId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<ClipboardItem[]>("merge_items", { sourceId, targetId });
  },
  splitItem: async (id, imageId, paths) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<ClipboardItem[]>("split_item", {
      id,
      imageId,
      paths: paths || [],
    });
  },
}));
