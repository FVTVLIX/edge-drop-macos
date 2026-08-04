import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { useRef, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { ClipboardCard } from "./ClipboardCard";
import { Settings } from "./Settings";
import { DEFAULT_SETTINGS, SettingsData } from "../settings";
import { GearIcon, ChevronUpIcon, ChevronDownIcon } from "./icons";

export function Panel() {
  const open = useAppStore((s) => s.isOpen);
  const items = useAppStore((s) => s.items);
  const clearItems = useAppStore((s) => s.clearItems);
  const dragActive = useAppStore((s) => s.dragActive);
  const setDragActive = useAppStore((s) => s.setDragActive);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const setItems = useAppStore((s) => s.setItems);
  const internalDragReq = useAppStore((s) => s.internalDragReq);
  const toasts = useAppStore((s) => s.toasts);
  const pushToast = useAppStore((s) => s.pushToast);
  const pinnedItems = items.filter((i) => i.pinned);
  const recentItems = items.filter((i) => !i.pinned);

  // Filter by search query
  const filteredPinned = pinnedItems.filter((i) =>
    i.data.kind === "text" ? i.data.text.toLowerCase().includes(query.toLowerCase()) : true
  );
  const filteredRecent = recentItems.filter((i) =>
    i.data.kind === "text" ? i.data.text.toLowerCase().includes(query.toLowerCase()) : true
  );
  const [pinnedCollapsed, setPinnedCollapsed] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const cancelConfirmation = () => setConfirmClear(false);
    const timeout = window.setTimeout(cancelConfirmation, 6000);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelConfirmation();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmClear]);

  useEffect(() => {
    if (!open || items.length === 0) setConfirmClear(false);
  }, [open, items.length]);

  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<SettingsData>("get_settings"))
      .then((loaded) => {
        setSettings(loaded);
        setSettingsReady(true);
      })
      .catch((error) => {
        setSettingsReady(true);
        pushToast(`Couldn't load settings: ${String(error)}`, "error");
      });
  }, [pushToast]);

  useEffect(() => {
    if (!settingsReady) return;
    const timer = window.setTimeout(() => {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("update_settings", { settings }))
        .catch((error) => pushToast(`Couldn't save settings: ${String(error)}`, "error"));
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
  useEffect(() => {
    if (open && topRecentId !== prevTopId.current) {
      listRef.current?.scrollTo({ top: 0 });
    }
    prevTopId.current = topRecentId;
  }, [open, topRecentId]);

  const topOffset = "50%";
  const triggerHeightPx = window.innerHeight * settings.hotZoneHeight;
  const halfTrigger = triggerHeightPx / 2;
  const panelHeightStr = `${Math.round(settings.panelHeight * 100)}vh`;

  const clipPath = open
    ? "inset(-100px -100px -100px 0px round 0px 24px 24px 0px)"
    : `inset(${window.innerHeight / 2 - halfTrigger}px ${window.innerWidth - settings.hotZoneWidth}px ${window.innerHeight / 2 - halfTrigger}px 0px round 0px 24px 24px 0px)`;

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "never"}>
    <div className={`root ${settings.uiStyle === "compact" ? "compact" : ""}${settings.reduceMotion ? " reduce-motion" : ""}`}>
      <motion.div
        className="blade-container"
        initial={false}
        style={{
          position: "absolute",
          top: topOffset,
          y: "-50%",
          left: 0,
          zIndex: 10,
          pointerEvents: open ? "auto" : "none",
          originX: 0,
          originY: 0.5,
          clipPath,
        }}
        animate={{
          scale: open ? [0.94, 1.02, 0.99, 1] : 1,
          filter: open ? "blur(0px)" : "blur(16px)",
        }}
        transition={{
          scale: {
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
          },
          filter: {
            duration: open ? 0.8 : 0.45,
            ease: open ? [0.16, 1, 0.3, 1] : [0.4, 0, 0.2, 1],
          },
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
              <button className="act" title="Settings" onClick={() => setSettingsOpen(!settingsOpen)}>
                <GearIcon width={16} height={16} />
              </button>
              <span className="count" style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
                {items.length} item{items.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <AnimatePresence initial={false}>
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
          <AnimatePresence mode="wait">
            {settingsOpen ? (
              <Settings
                key="settings"
                settings={settings}
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
                Move your cursor to the left edge to open
              </div>
            </div>
          ) : (
            <motion.div className="list" ref={listRef} layoutScroll
              onScroll={(e) => setShowScrollTop(e.currentTarget.scrollTop > 50)}
            >
              {/* Pinned section */}
              {pinnedItems.length > 0 && (
                <section className="pinned-section">
                  <div
                    className="section-label pinned-header-interactive"
                    onClick={() => setPinnedCollapsed(!pinnedCollapsed)}
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
              {recentItems.length > 0 && (
                <section>
                  {pinnedItems.length > 0 && (
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
              {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
            <div className="spacer" />
            <AnimatePresence initial={false} mode="wait">
              {confirmClear ? (
                <motion.div
                  key="confirm-clear"
                  className="clear-confirm"
                  initial={{ opacity: 0, scale: 0.9, x: 6 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, x: 6 }}
                  transition={{ duration: 0.14 }}
                >
                  <span>Clear shelf?</span>
                  <button className="delete-choice cancel" onClick={() => setConfirmClear(false)}>
                    No
                  </button>
                  <button
                    className="delete-choice confirm"
                    onClick={() => {
                      clearItems();
                      setConfirmClear(false);
                    }}
                  >
                    Yes
                  </button>
                </motion.div>
              ) : (
                <motion.button
                  key="request-clear"
                  className="text-btn danger"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => setConfirmClear(true)}
                  disabled={items.length === 0}
                  title="Clear shelf"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>Clear</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
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
