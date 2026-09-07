import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { ClipboardCard } from "./ClipboardCard";
import { Settings } from "./Settings";
import { PreviewFlyout } from "./PreviewFlyout";
import { ClearMenu } from "./ClearMenu";
import { DEFAULT_SETTINGS, DisplayOption, SettingsData } from "../settings";
import { GearIcon, ChevronUpIcon, ChevronDownIcon } from "./icons";
import { filterItems } from "../lib/filterItems";
import type { TypeFilter } from "../lib/filterItems";

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "links", label: "Links" },
  { id: "images", label: "Images" },
  { id: "files", label: "Files" },
];

export function Panel() {
  const open = useAppStore((s) => s.isOpen);
  const items = useAppStore((s) => s.items);
  const clearItems = useAppStore((s) => s.clearItems);
  const dragActive = useAppStore((s) => s.dragActive);
  const setDragActive = useAppStore((s) => s.setDragActive);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const typeFilter = useAppStore((s) => s.typeFilter);
  const setTypeFilter = useAppStore((s) => s.setTypeFilter);
  const setItems = useAppStore((s) => s.setItems);
  const internalDragReq = useAppStore((s) => s.internalDragReq);
  const toasts = useAppStore((s) => s.toasts);
  const pushToast = useAppStore((s) => s.pushToast);
  const closePreview = useAppStore((s) => s.closePreview);
  const pinnedItems = items.filter((item) => item.pinned);
  const recentItems = items.filter((item) => !item.pinned);
  const filteredPinned = filterItems(pinnedItems, query, typeFilter);
  const filteredRecent = filterItems(recentItems, query, typeFilter);
  const visibleCount = filteredPinned.length + filteredRecent.length;
  const [pinnedCollapsedByFilter, setPinnedCollapsedByFilter] = useState<Record<TypeFilter, boolean>>(() => {
    const fallback = { all: true, text: true, links: true, images: true, files: true };
    try {
      return { ...fallback, ...JSON.parse(localStorage.getItem("edge_drop_pinned_collapsed_map") || "{}") };
    } catch {
      return fallback;
    }
  });
  const pinnedCollapsed = pinnedCollapsedByFilter[typeFilter];
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [displays, setDisplays] = useState<DisplayOption[]>([]);
  const [settingsReady, setSettingsReady] = useState(false);

  const togglePinnedCollapsed = () => {
    setPinnedCollapsedByFilter((current) => ({
      ...current,
      [typeFilter]: !current[typeFilter],
    }));
  };

  useEffect(() => {
    localStorage.setItem("edge_drop_pinned_collapsed_map", JSON.stringify(pinnedCollapsedByFilter));
  }, [pinnedCollapsedByFilter]);

  useEffect(() => {
    if (!open) closePreview();
  }, [open, items.length, closePreview]);

  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(async ({ invoke }) => Promise.all([
        invoke<SettingsData>("get_settings"),
        invoke<DisplayOption[]>("get_displays"),
      ]))
      .then(([loaded, availableDisplays]) => {
        setSettings(loaded);
        setDisplays(availableDisplays);
        setSettingsReady(true);
      })
      .catch((error) => {
        setSettingsReady(true);
        pushToast(`Couldn't load settings: ${String(error)}`, "error");
      });
  }, [pushToast]);

  useEffect(() => {
    if (!settingsOpen) return;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<DisplayOption[]>("get_displays"))
      .then(setDisplays)
      .catch(() => undefined);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsReady) return;
    const timer = window.setTimeout(() => {
      import("@tauri-apps/api/core")
        .then(async ({ invoke }) => {
          try {
            await invoke("update_settings", { settings });
          } catch (error) {
            pushToast(`Couldn't save settings: ${String(error)}`, "error");
            const persisted = await invoke<SettingsData>("get_settings");
            setSettings(persisted);
          }
        })
        .catch((error) => pushToast(`Couldn't reload settings: ${String(error)}`, "error"));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [settings, settingsReady, pushToast]);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const hasSupportedContent = (e: React.DragEvent) =>
    hasFiles(e) || ["text/plain", "text/uri-list", "text/html"].some((type) =>
      e.dataTransfer.types.includes(type)
    );

  const onDragEnter = (e: React.DragEvent) => {
    if (!internalDragReq && hasSupportedContent(e)) {
      e.preventDefault();
      setDragActive(true);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    if (hasSupportedContent(e)) e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragActive(false);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (internalDragReq || hasFiles(e)) {
      setDragActive(false);
      return;
    }

    const html = e.dataTransfer.getData("text/html");
    const uri = e.dataTransfer
      .getData("text/uri-list")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    let text = e.dataTransfer.getData("text/plain").trim() || uri || "";
    if (!text && html) {
      text = new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() || "";
    }

    if (text) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const items = await invoke<import("../store").ClipboardItem[]>("handle_content_drop", {
          text,
          html: html || null,
        });
        setItems(items);
      } catch (error) {
        pushToast(
          `Couldn't import the drop: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    }
    setDragActive(false);
  };

  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to top when opening after 60s or new items
  const prevOpen = useRef(open);
  const lastClosedAt = useRef(Date.now());
  const topRecentId = recentItems[0]?.id;

  useEffect(() => {
    if (!open && prevOpen.current) {
      lastClosedAt.current = Date.now();
    } else if (open && !prevOpen.current) {
      if (Date.now() - lastClosedAt.current >= 60000) {
        listRef.current?.scrollTo({ top: 0 });
      }
    }
    prevOpen.current = open;
  }, [open]);

  // Scroll to top when new items appear while open
  const prevTopId = useRef(topRecentId);
  const previousItemCount = useRef(items.length);
  useEffect(() => {
    const itemWasAddedOrPromoted = items.length >= previousItemCount.current;
    if (open && itemWasAddedOrPromoted && topRecentId !== prevTopId.current) {
      listRef.current?.scrollTo({ top: 0 });
    }
    prevTopId.current = topRecentId;
    previousItemCount.current = items.length;
  }, [open, topRecentId, items.length]);

  const panelHeightPx = window.innerHeight * settings.panelHeight;
  const panelTopPx = (window.innerHeight - panelHeightPx) * settings.verticalOffset;
  const topOffset = `${panelTopPx + panelHeightPx / 2}px`;
  const triggerHeightPx = window.innerHeight * settings.hotZoneHeight;
  const triggerTopPx = Math.max(0, Math.min(
    window.innerHeight - triggerHeightPx,
    settings.triggerAlignment === "top"
      ? panelTopPx
      : settings.triggerAlignment === "bottom"
        ? panelTopPx + panelHeightPx - triggerHeightPx
        : panelTopPx + (panelHeightPx - triggerHeightPx) / 2
  ));
  const panelHeightStr = `${Math.round(settings.panelHeight * 100)}vh`;
  const isRight = settings.edgePosition === "right";

  const clipPath = open
    ? "inset(-100px -100px -100px -100px round 24px)"
    : isRight
      ? `inset(${triggerTopPx}px 0px ${window.innerHeight - triggerTopPx - triggerHeightPx}px ${384 - settings.hotZoneWidth}px round 24px 0px 0px 24px)`
      : `inset(${triggerTopPx}px ${384 - settings.hotZoneWidth}px ${window.innerHeight - triggerTopPx - triggerHeightPx}px 0px round 0px 24px 24px 0px)`;

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "never"}>
    <div
      className={`root ${isRight ? "edge-right" : "edge-left"} ${settings.uiStyle === "compact" ? "compact" : ""}${settings.reduceMotion ? " reduce-motion" : ""}`}
      style={{ "--font-scale": settings.fontSizeScale } as React.CSSProperties}
    >
      <motion.div
        className="blade-container"
        initial={false}
        style={{
          position: "absolute",
          top: topOffset,
          y: "-50%",
          left: isRight ? undefined : 0,
          right: isRight ? 0 : undefined,
          zIndex: 10,
          pointerEvents: open ? "auto" : "none",
          originX: isRight ? 1 : 0,
          originY: 0.5,

        }}
        animate={{
          clipPath,
          x: open ? 0 : isRight ? 24 : -24,
          scale: open && settings.bounceAnimation && !settings.reduceMotion ? [0.94, 1.02, 0.99, 1] : 1,
        }}
        transition={{
          duration: settings.reduceMotion ? 0 : settings.bounceAnimation ? 0.55 : 0.32,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {/* Corner flares */}
        <div className="flare-top">
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <path d="M 0 0 L 0 30 L 30 30 A 30 30 0 0 1 0 0 Z" fill="#000000" />
          </svg>
        </div>
        <div className="flare-bottom">
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
            <path d="M 0 30 L 0 0 L 30 0 A 30 30 0 0 0 0 30 Z" fill="#000000" />
          </svg>
        </div>

        <div className="blade" style={{ height: panelHeightStr }}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest("button, input, textarea, a, [data-id]")) closePreview();
          }}
        >
          <SplitDropZone />

          {/* Drop overlay */}
          <AnimatePresence>
            {dragActive && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  position: "absolute", inset: 0, zIndex: 100,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: "14px",
                  pointerEvents: "none",
                  background: "rgba(6, 6, 8, 0.82)",
                  backdropFilter: "blur(28px)",
                  textAlign: "center", padding: "24px",
                }}
              >
                <div style={{
                  width: 52, height: 52, borderRadius: 16,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "rgba(255,255,255,0.9)",
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v13M8 12l4 4 4-4M4 20h16" /></svg>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.95)" }}>Drop to save</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Any file, image, link, or text</div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Header */}
          <div className="header">
            <div className="header-left">
              <img src={`/logo.svg?v=${Date.now()}`} alt="Edge Drop" style={{ width: 28, height: 28 }} />
            </div>
            <div className="header-actions">
              {items.length > 0 && (
                <input
                  className="search-input"
                  type="text"
                  placeholder="Filter..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{
                    width: 80,
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.04)",
                    color: "rgba(255,255,255,0.8)",
                    fontSize: 12,
                    outline: "none",
                    fontWeight: 400,
                  }}
                />
              )}
              <button className="act" title="Settings" onClick={() => {
                closePreview();
                setSettingsOpen(!settingsOpen);
              }}>
                <GearIcon width={16} height={16} />
              </button>
              <span className="count" style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
                {items.length} item{items.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {!settingsOpen && items.length > 0 && (
            <div className="type-filter-track" role="tablist" aria-label="Filter clipboard items by type">
              {TYPE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  role="tab"
                  aria-selected={typeFilter === filter.id}
                  className={`type-filter-chip${typeFilter === filter.id ? " active" : ""}`}
                  onClick={() => {
                    closePreview();
                    setTypeFilter(filter.id);
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait">
            {toasts.length > 0 && (
              <motion.div
                className="toast-stack"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
              >
                {toasts.map((toast) => (
                  <motion.div
                    layout
                    key={toast.id}
                    className={`toast ${toast.tone}`}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                  >
                    {toast.message}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Content: toggle between Settings and ItemList */}
          <AnimatePresence initial={false}>
            {settingsOpen ? (
              <Settings
                key="settings"
                settings={settings}
                displays={displays}
                onUpdate={(patch) => setSettings((current) => ({ ...current, ...patch }))}
                onClose={() => setSettingsOpen(false)}
                onReset={() => setSettings({ ...DEFAULT_SETTINGS })}
              />
            ) : items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div className="empty-text">
                Copy anything — text, images, or files<br />
                and it appears here instantly.
              </div>
              <div className="empty-hint">
                Move your cursor to the {settings.edgePosition} edge to open
              </div>
            </div>
          ) : (
            <motion.div className="list" ref={listRef} layoutScroll
              onScroll={(e) => setShowScrollTop(e.currentTarget.scrollTop > 50)}
            >
              {visibleCount === 0 && (
                <div className="filter-empty-state">
                  <strong>No matching items</strong>
                  <span>Try another type or search term.</span>
                </div>
              )}

              {/* Pinned section */}
              {filteredPinned.length > 0 && (
                <section className="pinned-section">
                  <div
                    className="section-label pinned-header-interactive"
                    onClick={togglePinnedCollapsed}
                  >
                    <div className="pinned-header-left">
                      <span>Pinned</span>
                      <span className="pinned-count-badge">{filteredPinned.length}</span>
                    </div>
                    <div className="pinned-header-right">
                      <span className="pinned-toggle-hint">
                        {pinnedCollapsed ? "Expand" : "Compress"}
                      </span>
                      <button className="act bundle-collapse-btn">
                        {pinnedCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                      </button>
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {!pinnedCollapsed &&
                      filteredPinned.map((it) => (
                        <ClipboardCard key={it.id} item={it} />
                      ))}
                  </AnimatePresence>
                </section>
              )}

              {/* Recent section */}
              {filteredRecent.length > 0 && (
                <section>
                  {filteredPinned.length > 0 && (
                    <div className="section-label">Recent</div>
                  )}
                  <AnimatePresence initial={false}>
                    {filteredRecent.map((it) => (
                      <ClipboardCard key={it.id} item={it} />
                    ))}
                  </AnimatePresence>
                </section>
              )}

              {/* Scroll-to-top */}
              <AnimatePresence>
                {showScrollTop && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 20 }}
                    className="scroll-top-btn"
                    onClick={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15" /></svg>
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          )}
          </AnimatePresence>

          {/* Footer */}
          <div className="footer">
            <span className="count">
              {visibleCount === items.length
                ? `${items.length} item${items.length !== 1 ? "s" : ""}`
                : `${visibleCount} of ${items.length}`}
            </span>
            <div className="spacer" />
            <ClearMenu
              items={[...filteredPinned, ...filteredRecent]}
              disabled={filteredRecent.length === 0}
              panelOpen={open}
              scoped={typeFilter !== "all" || query.trim().length > 0}
              onClear={async (ids) => {
                try {
                  await clearItems(ids);
                } catch (error) {
                  pushToast(`Couldn't clear history: ${String(error)}`, "error");
                }
              }}
              onClearAll={async () => {
                try {
                  const scoped = typeFilter !== "all" || query.trim().length > 0;
                  await clearItems(scoped ? filteredRecent.map((item) => item.id) : undefined);
                } catch (error) {
                  pushToast(`Couldn't clear history: ${String(error)}`, "error");
                }
              }}
            />
          </div>
        </div>
      </motion.div>
      {open && !settingsOpen && <PreviewFlyout isRight={isRight} panelHeight={panelHeightPx} />}
    </div>
    </MotionConfig>
  );
}

function SplitDropZone() {
  const request = useAppStore((state) => state.internalDragReq);
  const isSubitem = Boolean(request?.imageId || request?.paths?.length);

  return (
    <AnimatePresence>
      {isSubitem && (
        <motion.div
          className="split-dropzone"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          title="Drop here to ungroup"
        >
          <div className="glow-line" />
          <span>Ungroup</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
