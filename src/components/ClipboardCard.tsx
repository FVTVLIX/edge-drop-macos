import { memo, useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardItem, DragRequest, useAppStore } from "../store";
import {
  ChevronUpIcon,
  CopyIcon,
  FileKindIcon,
  MinusIcon,
  PinFillIcon,
  PinIcon,
  TrashIcon,
} from "./icons";
import { describeFileType, extOf } from "../lib/fileType";

interface Props {
  item: ClipboardItem;
}

const MAX_STACK = 10;

const rowVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 420, damping: 30 },
  },
  exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.14 } },
};

function relativeTime(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function kindLabel(item: ClipboardItem): string {
  switch (item.data.kind) {
    case "text": return item.data.isUrl ? "Link" : "Text";
    case "image": return `${(item.data.ext || "png").toUpperCase()} image`;
    case "image-collection": return `${item.data.images.length} images`;
    case "files": {
      if (item.data.paths.length === 1) {
        const entry = item.entries?.[0];
        return describeFileType(entry?.ext || extOf(item.data.paths[0]), entry?.isDirectory);
      }
      const folderCount = item.entries?.filter((entry) => entry.isDirectory).length || 0;
      const fileCount = item.data.paths.length - folderCount;
      if (folderCount === item.data.paths.length) return `${folderCount} folders`;
      if (folderCount > 0) return `${folderCount} folder${folderCount === 1 ? "" : "s"} + ${fileCount} file${fileCount === 1 ? "" : "s"}`;
      return `${item.data.paths.length} files`;
    }
  }
}

function mergeFamily(item: ClipboardItem): "images" | "files" | "text" {
  if (item.data.kind === "image" || item.data.kind === "image-collection") return "images";
  if (item.data.kind === "files") return "files";
  return "text";
}

export const ClipboardCard = memo(function ClipboardCard({ item }: Props) {
  const togglePin = useAppStore((state) => state.togglePin);
  const deleteItem = useAppStore((state) => state.deleteItem);
  const splitItem = useAppStore((state) => state.splitItem);
  const pushToast = useAppStore((state) => state.pushToast);
  const setInternalDragReq = useAppStore((state) => state.setInternalDragReq);
  const internalDragReq = useAppStore((state) => state.internalDragReq);
  const items = useAppStore((state) => state.items);
  const open = useAppStore((state) => state.isOpen);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isBundle =
    (item.data.kind === "files" && item.data.paths.length > 1) ||
    item.data.kind === "image-collection";
  const draggedItem = internalDragReq
    ? items.find((candidate) => candidate.id === internalDragReq.id)
    : undefined;
  const isDragSource = internalDragReq?.id === item.id;
  const isMergeTarget = Boolean(
    internalDragReq &&
    !isDragSource &&
    draggedItem &&
    mergeFamily(draggedItem) !== "text" &&
    mergeFamily(draggedItem) === mergeFamily(item)
  );

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setConfirmDelete(false);
    }
  }, [open]);

  useEffect(() => {
    if (!confirmDelete) return;
    const cancelConfirmation = () => setConfirmDelete(false);
    const timeout = window.setTimeout(cancelConfirmation, 6000);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelConfirmation();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmDelete]);

  const copyItem = useCallback(async (request: DragRequest, event?: React.MouseEvent) => {
    event?.stopPropagation();
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("copy_item", { request });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch (error) {
      pushToast(
        `Couldn't copy this item: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  }, [pushToast]);

  const startNativeDrag = useCallback((request: DragRequest) => {
    setInternalDragReq(request);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("start_drag", { request }))
      .catch((error) => {
        const state = useAppStore.getState();
        state.pushToast(
          `Couldn't start the drag: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
        state.setInternalDragReq(null);
      });
  }, [setInternalDragReq]);

  const handleDragStart = useCallback((event: React.DragEvent, request: DragRequest) => {
    event.preventDefault();
    event.stopPropagation();
    startNativeDrag(request);
  }, [startNativeDrag]);

  return (
    <motion.div
      layout
      initial={open ? { opacity: 0, y: 8, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.14 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className={`item${item.pinned ? " pinned" : ""}${isBundle ? " bundle" : ""}${isDragSource ? " drag-source" : ""}${isMergeTarget ? " merge-ready" : ""}`}
    >
      <div
        className="item-main"
        data-id={item.id}
        draggable={!isBundle || !expanded}
        onDragStart={(event) => handleDragStart(event, { id: item.id })}
        onClick={isBundle && !expanded ? (event) => {
          event.stopPropagation();
          setExpanded(true);
        } : undefined}
        title={isBundle && !expanded ? "Click to open stack; drag to copy it out" : "Drag to copy out"}
      >
        <div className="body">
          {isBundle ? (
            <BundleContent
              item={item}
              expanded={expanded}
              onCollapse={() => setExpanded(false)}
              onDragStart={handleDragStart}
              onCopy={copyItem}
              onSplit={(imageId, paths) => splitItem(item.id, imageId, paths)}
            />
          ) : (
            <SinglePreview item={item} />
          )}

          <div className="meta">
            <span>{kindLabel(item)}</span>
            <span>{relativeTime(item.capturedAt)}</span>
            {item.hitCount > 1 && <span>· ×{item.hitCount}</span>}
            {item.data.kind === "image" && <span>· {item.data.width}×{item.data.height}</span>}
            {item.data.kind === "image" && <span>· {formatBytes(item.data.bytes)}</span>}
            {copied && <span style={{ color: "#fff" }}>· copied</span>}
          </div>
        </div>

        {!expanded && (
          <motion.div
            layout
            className={`actions${confirmDelete ? " confirming-delete" : ""}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className={`act${item.pinned ? " active" : ""}`}
              title={item.pinned ? "Unpin" : "Pin"}
              onClick={() => togglePin(item.id, !item.pinned)}
            >
              {item.pinned ? <PinFillIcon /> : <PinIcon />}
            </button>
            <button className="act" title="Copy" onClick={(event) => void copyItem({ id: item.id }, event)}>
              <CopyIcon />
            </button>
            <AnimatePresence initial={false} mode="wait">
              {confirmDelete ? (
                <motion.div
                  key="confirm-delete"
                  className="delete-confirm"
                  initial={{ opacity: 0, scale: 0.82, x: 6 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.86, x: 5 }}
                  transition={{ duration: 0.14 }}
                >
                  <span>Delete?</span>
                  <div>
                    <button
                      className="delete-choice cancel"
                      title="Cancel deletion"
                      aria-label="Cancel deletion"
                      onClick={() => setConfirmDelete(false)}
                    >
                      No
                    </button>
                    <button
                      className="delete-choice confirm"
                      title="Confirm deletion"
                      aria-label="Confirm deletion"
                      onClick={() => deleteItem(item.id)}
                    >
                      Yes
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.button
                  key="request-delete"
                  className="act danger"
                  title="Delete"
                  aria-label="Delete item"
                  initial={{ opacity: 0, scale: 0.86 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.78 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
});

function BundleContent({
  item,
  expanded,
  onCollapse,
  onDragStart,
  onCopy,
  onSplit,
}: {
  item: ClipboardItem;
  expanded: boolean;
  onCollapse: () => void;
  onDragStart: (event: React.DragEvent, request: DragRequest) => void;
  onCopy: (request: DragRequest, event?: React.MouseEvent) => Promise<void>;
  onSplit: (imageId?: string, paths?: string[]) => Promise<void>;
}) {
  return (
    <div className="fluid-bundle">
      <AnimatePresence initial={false} mode="wait">
        {expanded ? (
          <motion.div
            key="expanded"
            className="fluid-list"
            initial={{ opacity: 0, height: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, height: "auto", filter: "blur(0px)" }}
            exit={{ opacity: 0, height: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.2 }}
          >
            <div className="bundle-actions">
              <button
                className="bundle-collapse-zone"
                title="Collapse stack"
                onClick={(event) => {
                  event.stopPropagation();
                  onCollapse();
                }}
              >
                <ChevronUpIcon width={16} height={16} />
                <span>Collapse</span>
              </button>
              <span className="bundle-capacity">
                {item.data.kind === "image-collection" ? item.data.images.length : item.data.kind === "files" ? item.data.paths.length : 0} / {MAX_STACK}
              </span>
            </div>

            {item.data.kind === "image-collection" && item.data.images.map((image) => (
              <motion.div
                key={image.imageId}
                className="fluid-list-row"
                variants={rowVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                draggable
                onDragStartCapture={(event: React.DragEvent<HTMLDivElement>) =>
                  onDragStart(event, { id: item.id, imageId: image.imageId })
                }
                title="Drag this image out, or use minus to ungroup it"
              >
                <img className="fluid-row-thumb" src={image.preview || ""} alt="" draggable={false} />
                <div className="fluid-list-text-wrap">
                  <span className="fluid-list-text">Image · {image.width}×{image.height}</span>
                  <span className="fluid-list-sub">{formatBytes(image.bytes)}</span>
                </div>
                <span className="subitem-actions">
                  <button
                    className="act subitem-action-btn"
                    title="Copy this image"
                    aria-label="Copy this image"
                    onClick={(event) => void onCopy({ id: item.id, imageId: image.imageId }, event)}
                  >
                    <CopyIcon width={12} height={12} />
                  </button>
                  <button
                    className="act subitem-action-btn"
                    title="Ungroup image"
                    aria-label="Ungroup image"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onSplit(image.imageId);
                    }}
                  >
                    <MinusIcon width={12} height={12} />
                  </button>
                </span>
              </motion.div>
            ))}

            {item.data.kind === "files" && item.data.paths.map((path, index) => {
              const entry = item.entries?.[index];
              return (
                <motion.div
                  key={path}
                  className="fluid-list-row"
                  variants={rowVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  draggable
                  onDragStartCapture={(event: React.DragEvent<HTMLDivElement>) =>
                    onDragStart(event, { id: item.id, paths: [path] })
                  }
                  title="Drag this file out, or use minus to ungroup it"
                >
                  {entry?.isImage && entry.preview ? (
                    <img className="fluid-row-thumb" src={entry.preview} alt="" draggable={false} />
                  ) : (
                    <span className="fluid-list-icon"><FileKindIcon path={path} isDirectory={entry?.isDirectory} width={17} height={17} /></span>
                  )}
                  <div className="fluid-list-text-wrap">
                    <span className="fluid-list-text">{entry?.name || basename(path)}</span>
                    <span className="fluid-list-sub">
                      {describeFileType(entry?.ext || extOf(path), entry?.isDirectory)}
                      {Boolean(entry?.size) && ` · ${formatBytes(entry?.size || 0)}`}
                    </span>
                  </div>
                  <span className="subitem-actions">
                    <button
                      className="act subitem-action-btn"
                      title="Copy this item"
                      aria-label={`Copy ${entry?.name || basename(path)}`}
                      onClick={(event) => void onCopy({ id: item.id, paths: [path] }, event)}
                    >
                      <CopyIcon width={12} height={12} />
                    </button>
                    <button
                      className="act subitem-action-btn"
                      title="Ungroup file"
                      aria-label={`Ungroup ${entry?.name || basename(path)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onSplit(undefined, [path]);
                      }}
                    >
                      <MinusIcon width={12} height={12} />
                    </button>
                  </span>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
          >
            <CollapsedStack item={item} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CollapsedStack({ item }: { item: ClipboardItem }) {
  const images = item.data.kind === "image-collection"
    ? item.data.images.map((image) => image.preview).filter(Boolean)
    : item.data.kind === "files"
      ? (item.entries || []).filter((entry) => entry.isImage && entry.preview).map((entry) => entry.preview)
      : [];
  const count = item.data.kind === "image-collection"
    ? item.data.images.length
    : item.data.kind === "files" ? item.data.paths.length : 0;

  if (images.length > 0) {
    return (
      <>
        <div className="bundle-stack-large">
          {images.slice(0, 4).reverse().map((preview, index, array) => {
            const offset = array.length - 1 - index;
            const centeredX = offset * 18 - ((array.length - 1) * 9);
            return (
              <motion.img
                key={`${preview}-${index}`}
                src={preview}
                className="bundle-stack-card"
                animate={{ x: centeredX, y: offset * 4, rotate: offset * 5 - ((array.length - 1) * 2.5), scale: 1 - offset * 0.045 }}
                style={{ zIndex: 10 - offset }}
                draggable={false}
              />
            );
          })}
        </div>
        <div className="bundle-more-label">{count} item{count === 1 ? "" : "s"} · click to open</div>
      </>
    );
  }

  return (
    <div className="collapsed-file-stack">
      <div className="collapsed-file-cards">
        {[0, 1, 2].slice(0, Math.min(3, count)).map((index) => (
          <span key={index} style={{ transform: `translate(${index * 7}px, ${index * 3}px) rotate(${index * 3 - 3}deg)` }}>
            <FileKindIcon
              path={item.data.kind === "files" ? item.data.paths[index] : ""}
              isDirectory={item.entries?.[index]?.isDirectory}
              width={24}
              height={24}
            />
          </span>
        ))}
      </div>
      <div>
        <strong>{kindLabel(item)}</strong>
        <small>Click to open · drag to copy all</small>
      </div>
    </div>
  );
}

function SinglePreview({ item }: { item: ClipboardItem }) {
  if (item.data.kind === "text") {
    return <div className={`preview${item.data.text.length < 60 ? " single" : ""}${item.data.isUrl ? " url" : ""}`}>{item.data.text}</div>;
  }
  if (item.data.kind === "image") {
    return item.data.preview ? <div className="image-preview"><img src={item.data.preview} alt="" draggable={false} /></div> : null;
  }
  if (item.data.kind === "files") {
    const entry = item.entries?.[0];
    const path = item.data.paths[0];
    if (entry?.isImage && entry.preview) {
      return <div className="image-preview"><img src={entry.preview} alt={entry.name} draggable={false} /></div>;
    }
    return (
      <div className="single-file-preview">
        <span className="single-file-icon"><FileKindIcon path={path} isDirectory={entry?.isDirectory} width={24} height={24} /></span>
        <span className="single-file-meta">
          <strong>{entry?.name || basename(path)}</strong>
          <small>
            {describeFileType(entry?.ext || extOf(path), entry?.isDirectory)}
            {Boolean(entry?.size) && ` · ${formatBytes(entry?.size || 0)}`}
          </small>
        </span>
      </div>
    );
  }
  return null;
}
