import { create } from "zustand";

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
  internalDragReq: DragRequest | null;
  setInternalDragReq: (req: DragRequest | null) => void;
  toasts: ToastMessage[];
  pushToast: (message: string, tone?: ToastMessage["tone"]) => void;
  dismissToast: (id: string) => void;
  togglePin: (id: string, pinned: boolean) => void;
  deleteItem: (id: string) => void;
  clearItems: () => void;
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
  internalDragReq: null,
  setInternalDragReq: (req) => set({ internalDragReq: req }),
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
  clearItems: () => {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("clear_items")
    );
    set((s) => ({
      items: s.items.filter((i) => i.pinned),
    }));
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
