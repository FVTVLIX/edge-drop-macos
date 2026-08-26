import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardItem, DragRequest, useAppStore } from "../store";
import { describeFileType, extOf } from "../lib/fileType";
import { ChevronDownIcon, ChevronUpIcon, CopyIcon, FileKindIcon, LinkIcon, MinusIcon } from "./icons";
import { tryPaste } from "../lib/tryPaste";
import { parseUrlPreview } from "../lib/urlPreview";

interface PreviewFlyoutProps {
  isRight: boolean;
  panelHeight: number;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isStack(item: ClipboardItem): boolean {
  return item.data.kind === "image-collection" ||
    (item.data.kind === "files" && item.data.paths.length > 1);
}

export function PreviewFlyout({ isRight, panelHeight }: PreviewFlyoutProps) {
  const previewItemId = useAppStore((state) => state.previewItemId);
  const previewItemRect = useAppStore((state) => state.previewItemRect);
  const items = useAppStore((state) => state.items);
  const closePreview = useAppStore((state) => state.closePreview);
  const item = previewItemId ? items.find((candidate) => candidate.id === previewItemId) : undefined;
  const closeTimer = useRef<number>();
  const panelTop = (window.innerHeight - panelHeight) / 2;
  const itemCenter = previewItemRect ? previewItemRect.top + previewItemRect.height / 2 : window.innerHeight / 2;
  const originY = `${Math.max(0, Math.min(100, ((itemCenter - panelTop) / panelHeight) * 100))}%`;

  const cancelClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(closePreview, 180);
  }, [cancelClose, closePreview]);

  useEffect(() => {
    if (previewItemId && !item) closePreview();
  }, [previewItemId, item, closePreview]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelClose();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelClose, closePreview]);

  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_preview_open", { open: Boolean(item) }))
      .catch(() => undefined);
    return () => {
      if (item) {
        import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("set_preview_open", { open: false }))
          .catch(() => undefined);
      }
    };
  }, [item?.id]);

  return (
    <AnimatePresence>
      {item && (
        <motion.aside
          key={item.id}
          className={`preview-flyout-host ${isRight ? "right" : "left"}`}
          style={{ top: panelTop, height: panelHeight }}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        >
          <motion.div
            className="preview-flyout"
            initial={{ opacity: 0, scale: 0.88, x: isRight ? 10 : -10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.88, x: isRight ? 10 : -10 }}
            transition={{ type: "spring", stiffness: 420, damping: 34, opacity: { duration: 0.15 } }}
            style={{ transformOrigin: `${isRight ? "100%" : "0%"} ${originY}` }}
          >
            <PreviewContent item={item} />
          </motion.div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function PreviewContent({ item }: { item: ClipboardItem }) {
  const pushToast = useAppStore((state) => state.pushToast);
  const setInternalDragReq = useAppStore((state) => state.setInternalDragReq);
  const splitItem = useAppStore((state) => state.splitItem);
  const [expanded, setExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const stacked = isStack(item);

  useEffect(() => setExpanded(false), [item.id]);

  const copy = useCallback(async (request: DragRequest, key = "all") => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("copy_item", { request });
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 900);
    } catch (error) {
      pushToast(`Couldn't copy this item: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [pushToast]);

  const startDrag = useCallback((request: DragRequest) => {
    setInternalDragReq(request);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("start_drag", { request }))
      .catch((error) => {
        useAppStore.getState().setInternalDragReq(null);
        useAppStore.getState().pushToast(
          `Couldn't start the drag: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      });
  }, [setInternalDragReq]);

  const handleDragStart = (event: React.DragEvent, request: DragRequest) => {
    event.preventDefault();
    event.stopPropagation();
    startDrag(request);
  };

  const ungroup = async (imageId?: string, paths?: string[]) => {
    try {
      await splitItem(item.id, imageId, paths);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const paste = useCallback((request: DragRequest) => {
    tryPaste(() => {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("paste_item", { request }))
        .catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("Accessibility access")) {
            window.setTimeout(() => {
              import("@tauri-apps/api/core")
                .then(({ invoke }) => invoke("open_accessibility_settings"))
                .catch(() => undefined);
            }, 350);
          }
          pushToast(message, "error");
        });
    });
  }, [pushToast]);

  const openUrl = useCallback(async () => {
    if (item.data.kind !== "text" || !item.data.isUrl) return;
    try {
      const url = new URL(item.data.text.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS links can be opened.");
      }
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url.toString());
    } catch (error) {
      pushToast(`Couldn't open this link: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }, [item, pushToast]);

  return (
    <div className="preview-flyout-scroll">
      <div className="preview-flyout-toolbar">
        <span className="preview-flyout-kind">{previewTitle(item)}</span>
        <span className="preview-flyout-toolbar-actions">
          {item.data.kind === "text" && item.data.isUrl && (
            <button className="preview-action" onClick={() => void openUrl()} title="Open in your default browser">
              <LinkIcon width={14} height={14} />
              <span>Open</span>
            </button>
          )}
          <button className="preview-action" onClick={() => paste({ id: item.id })} title="Paste into the previous app">
            <span>Paste</span>
          </button>
          <button className="preview-action" onClick={() => void copy({ id: item.id })} title="Copy">
            <CopyIcon width={14} height={14} />
            <span>{copiedKey === "all" ? "Copied" : "Copy"}</span>
          </button>
        </span>
      </div>

      {stacked && !expanded ? (
        <CollapsedPreviewStack item={item} onExpand={() => setExpanded(true)} onDragStart={handleDragStart} />
      ) : (
        <ExpandedPreview
          item={item}
          stacked={stacked}
          copiedKey={copiedKey}
          onCopy={copy}
          onDragStart={handleDragStart}
          onUngroup={ungroup}
          onPaste={paste}
          onOpenUrl={openUrl}
        />
      )}

      {stacked && expanded && (
        <button className="preview-stack-toggle" onClick={() => setExpanded(false)}>
          <ChevronUpIcon width={15} height={15} /> Collapse stack
        </button>
      )}
    </div>
  );
}

function CollapsedPreviewStack({
  item,
  onExpand,
  onDragStart,
}: {
  item: ClipboardItem;
  onExpand: () => void;
  onDragStart: (event: React.DragEvent, request: DragRequest) => void;
}) {
  const count = item.data.kind === "image-collection" ? item.data.images.length :
    item.data.kind === "files" ? item.data.paths.length : 0;
  const previews = item.data.kind === "image-collection"
    ? item.data.images.map((image) => image.preview).filter(Boolean)
    : item.data.kind === "files"
      ? (item.entries || []).filter((entry) => entry.isImage && entry.preview).map((entry) => entry.preview)
      : [];

  return (
    <div className="preview-collapsed-stack" draggable onDragStart={(event) => onDragStart(event, { id: item.id })}>
      <div className="preview-stack-art">
        {previews.length > 0 ? previews.slice(0, 4).map((preview, index) => (
          <img key={`${preview}-${index}`} src={preview} alt="" draggable={false} style={{ transform: `translate(${index * 13}px, ${index * 5}px) rotate(${index * 3 - 4}deg)` }} />
        )) : [0, 1, 2].slice(0, Math.min(count, 3)).map((index) => (
          <span key={index} style={{ transform: `translate(${index * 12}px, ${index * 6}px) rotate(${index * 3 - 3}deg)` }}>
            <FileKindIcon
              path={item.data.kind === "files" ? item.data.paths[index] : ""}
              isDirectory={item.entries?.[index]?.isDirectory}
              width={38}
              height={38}
            />
          </span>
        ))}
      </div>
      <strong>{count} items in this stack</strong>
      <small>Drag to copy all, or expand to inspect and ungroup individual items.</small>
      <button className="preview-stack-toggle primary" onClick={(event) => { event.stopPropagation(); onExpand(); }}>
        <ChevronDownIcon width={15} height={15} /> Expand stack
      </button>
    </div>
  );
}

function ExpandedPreview({
  item,
  stacked,
  copiedKey,
  onCopy,
  onDragStart,
  onUngroup,
  onPaste,
  onOpenUrl,
}: {
  item: ClipboardItem;
  stacked: boolean;
  copiedKey: string | null;
  onCopy: (request: DragRequest, key?: string) => Promise<void>;
  onDragStart: (event: React.DragEvent, request: DragRequest) => void;
  onUngroup: (imageId?: string, paths?: string[]) => Promise<void>;
  onPaste: (request: DragRequest) => void;
  onOpenUrl: () => Promise<void>;
}) {
  if (item.data.kind === "text") {
    if (item.data.isUrl) {
      const info = parseUrlPreview(item.data.text.trim());
      return (
        <div
          className="preview-link-card"
          draggable
          onDragStart={(event) => onDragStart(event, { id: item.id })}
          onClick={() => void onOpenUrl()}
          title="Open in your default browser · Drag to copy out"
        >
          <div className="preview-link-brand" style={{ "--link-brand": info.brandColor } as React.CSSProperties}>
            <span>{info.serviceName.charAt(0).toUpperCase()}</span>
            <div><strong>{info.serviceName}</strong><small>{info.domain}</small></div>
          </div>
          {info.title && <h3>{info.title}</h3>}
          <p>{item.data.text}</p>
        </div>
      );
    }
    return (
      <div
        className={`preview-text-large${item.data.isUrl ? " url" : ""}`}
        draggable
        onDragStart={(event) => onDragStart(event, { id: item.id })}
        onClick={() => {
          if (window.getSelection()?.toString().trim()) return;
          onPaste({ id: item.id });
        }}
        title="Click to paste · Drag to copy out"
      >
        {item.data.text}
      </div>
    );
  }

  if (item.data.kind === "image") {
    return (
      <div className="preview-image-large" draggable onDragStart={(event) => onDragStart(event, { id: item.id })} onClick={() => onPaste({ id: item.id })} title="Click to paste · Drag to copy out">
        {item.data.preview && <img src={item.data.preview} alt="Preview" draggable={false} />}
        <small>{item.data.width}×{item.data.height} · {formatBytes(item.data.bytes)}</small>
      </div>
    );
  }

  if (item.data.kind === "image-collection") {
    return (
      <div className="preview-member-list">
        {item.data.images.map((image, index) => (
          <div className="preview-image-member" key={image.imageId} draggable onDragStart={(event) => onDragStart(event, { id: item.id, imageId: image.imageId })} onClick={() => onPaste({ id: item.id, imageId: image.imageId })} title="Click to paste this image · Drag to copy out">
            {image.preview && <img src={image.preview} alt={`Stack image ${index + 1}`} draggable={false} />}
            <div className="preview-member-footer">
              <span>{index + 1} of {item.data.kind === "image-collection" ? item.data.images.length : 0} · {image.width}×{image.height} · {formatBytes(image.bytes)}</span>
              <MemberActions
                copied={copiedKey === image.imageId}
                onCopy={() => onCopy({ id: item.id, imageId: image.imageId }, image.imageId)}
                onUngroup={() => onUngroup(image.imageId)}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (item.data.kind === "files") {
    return (
      <div className="preview-member-list">
        {item.data.paths.map((path, index) => {
          const entry = item.entries?.[index];
          return (
            <div className={`preview-file-member${entry?.isImage && entry.preview ? " with-image" : ""}`} key={path} draggable onDragStart={(event) => onDragStart(event, { id: item.id, paths: [path] })} onClick={() => onPaste({ id: item.id, paths: [path] })} title="Click to paste this item · Drag to copy out">
              {entry?.isImage && entry.preview ? (
                <img src={entry.preview} alt={entry.name} draggable={false} />
              ) : (
                <span className="preview-file-icon"><FileKindIcon path={path} isDirectory={entry?.isDirectory} width={32} height={32} /></span>
              )}
              <div className="preview-file-copy">
                <strong>{entry?.name || basename(path)}</strong>
                <small>{describeFileType(entry?.ext || extOf(path), entry?.isDirectory)}{Boolean(entry?.size) && ` · ${formatBytes(entry?.size || 0)}`}</small>
              </div>
              <MemberActions
                copied={copiedKey === path}
                onCopy={() => onCopy({ id: item.id, paths: [path] }, path)}
                onReveal={() => import("@tauri-apps/api/core")
                  .then(({ invoke }) => invoke("reveal_file", { path }))
                  .catch((error) => useAppStore.getState().pushToast(
                    `Couldn't show this item in Finder: ${error instanceof Error ? error.message : String(error)}`,
                    "error"
                  ))}
                onUngroup={stacked ? () => onUngroup(undefined, [path]) : undefined}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}

function MemberActions({ copied, onCopy, onReveal, onUngroup }: { copied: boolean; onCopy: () => void; onReveal?: () => void | Promise<unknown>; onUngroup?: () => void }) {
  return (
    <span className="preview-member-actions">
      <button className="preview-icon-action" onClick={(event) => { event.stopPropagation(); onCopy(); }} title="Copy this item">
        <CopyIcon width={13} height={13} /><span>{copied ? "Copied" : "Copy"}</span>
      </button>
      {onReveal && (
        <button className="preview-icon-action" onClick={(event) => { event.stopPropagation(); void onReveal(); }} title="Show in Finder">
          <span>Show</span>
        </button>
      )}
      {onUngroup && (
        <button className="preview-icon-action" onClick={(event) => { event.stopPropagation(); onUngroup(); }} title="Ungroup this item">
          <MinusIcon width={13} height={13} /><span>Ungroup</span>
        </button>
      )}
    </span>
  );
}

function previewTitle(item: ClipboardItem): string {
  if (item.data.kind === "text") return item.data.isUrl ? "Link preview" : "Text preview";
  if (item.data.kind === "image") return "Image preview";
  if (item.data.kind === "image-collection") return "Image stack";
  if (item.data.paths.length === 1) return item.entries?.[0]?.isDirectory ? "Folder preview" : "File preview";
  return "File stack";
}
