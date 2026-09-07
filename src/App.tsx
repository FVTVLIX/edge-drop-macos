import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Panel } from "./components/Panel";
import { useAppStore, ClipboardItem } from "./store";

async function hydratePreviews(items: ClipboardItem[]): Promise<ClipboardItem[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return Promise.all(
    items.map(async (item) => {
      if (item.data.kind === "image") {
        try {
          const preview = await invoke<string>("get_image_preview", {
            imageId: item.data.imageId,
          });
          return { ...item, data: { ...item.data, preview } };
        } catch (_) {
          return item;
        }
      }
      if (item.data.kind === "image-collection") {
        const images = await Promise.all(
          item.data.images.map(async (image) => {
            try {
              const preview = await invoke<string>("get_image_preview", {
                imageId: image.imageId,
              });
              return { ...image, preview };
            } catch (_) {
              return image;
            }
          })
        );
        return { ...item, data: { ...item.data, images } };
      }
      return item;
    })
  );
}

export default function App() {
  const { setItems, setIsOpen, setCursorPos } = useAppStore();

  useEffect(() => {
    // Native file drop from Finder
    let unlistenDrop: (() => void) | undefined;
    (async () => {
      unlistenDrop = await getCurrentWindow().onDragDropEvent(async (event) => {
        if (event.payload.type === "drop" && event.payload.paths.length > 0) {
          const dragState = useAppStore.getState();
          if (dragState.internalDragReq || Date.now() < dragState.internalDragGuardUntil) return;
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const items: ClipboardItem[] = await invoke("handle_file_drop", {
              paths: event.payload.paths,
            });
            setItems(await hydratePreviews(items));
          } catch (error) {
            useAppStore.getState().pushToast(
              `Couldn't import the drop: ${error instanceof Error ? error.message : String(error)}`,
              "error"
            );
          }
        }
      });
    })();
    const unlistenClip = listen<{ items: ClipboardItem[] }>(
      "clipboard-update",
      async (event) => {
        setItems(await hydratePreviews(event.payload.items));
      }
    );

    const unlistenNativeDrag = listen<{
      result: "dropped" | "cancelled";
      x: number;
      y: number;
      inside: boolean;
    }>("native-drag-ended", async (event) => {
      const state = useAppStore.getState();
      const request = state.internalDragReq;
      if (!request) return;

      try {
        if (event.payload.result === "dropped" && event.payload.inside) {
          const element = document.elementFromPoint(event.payload.x, event.payload.y);
          const targetCard = element?.closest<HTMLElement>(".item-main");
          const targetId = targetCard?.dataset.id;
          const splitTarget = element?.closest<HTMLElement>(".split-dropzone");
          const isSubitem = Boolean(request.imageId || request.paths?.length);

          if (targetId && targetId !== request.id) {
            await state.mergeItems(request.id, targetId);
          } else if (splitTarget && isSubitem) {
            await state.splitItem(request.id, request.imageId, request.paths);
          }
        } else if (
          event.payload.result === "dropped" &&
          !event.payload.inside &&
          !request.imageId &&
          !request.paths?.length
        ) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("record_item_use", { id: request.id });
        }
      } catch (error) {
        state.pushToast(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        useAppStore.getState().setInternalDragReq(null);
      }
    });

    const unlistenCursor = listen<{
      x: number; y: number; in_edge: boolean; in_zone: boolean;
      stick_position: string; display_width: number; display_height: number;
    }>("cursor-edge", (event) => {
      setCursorPos(event.payload.x, event.payload.y, event.payload.in_edge);
    });

    const unlistenToggle = listen<boolean>("panel-toggle", (event) => {
      setIsOpen(event.payload);
    });

    // Load initial state
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const items = await invoke<ClipboardItem[]>("get_items");
        setItems(await hydratePreviews(items));
      } catch (_) {}
    })();

    return () => {
      unlistenClip.then((f) => f());
      unlistenCursor.then((f) => f());
      unlistenToggle.then((f) => f());
      unlistenNativeDrag.then((f) => f());
      if (unlistenDrop) unlistenDrop();
    };
  }, []);

  return <Panel />;
}
