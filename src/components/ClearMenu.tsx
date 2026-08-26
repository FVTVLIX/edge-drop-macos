import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { ClipboardItem } from "../store";
import { TrashIcon } from "./icons";

interface Props {
  items: ClipboardItem[];
  disabled: boolean;
  panelOpen: boolean;
  scoped: boolean;
  onClear: (ids: string[]) => Promise<void>;
  onClearAll: () => Promise<void>;
}

const WINDOWS = [
  { label: "Last hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 24 hours", hours: 24 },
];

export function ClearMenu({ items, disabled, panelOpen, scoped, onClear, onClearAll }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen) setOpen(false);
  }, [panelOpen]);

  useEffect(() => {
    if (!open) {
      setConfirmAll(false);
      return;
    }
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const clearWindow = async (hours: number) => {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const ids = items
      .filter((item) => !item.pinned && item.capturedAt >= cutoff)
      .map((item) => item.id);
    setOpen(false);
    if (ids.length > 0) await onClear(ids);
  };

  return (
    <div className="clear-menu" ref={ref}>
      <button
        className="text-btn danger"
        onClick={() => !disabled && setOpen((current) => !current)}
        disabled={disabled}
        title="Clear clipboard history"
      >
        <TrashIcon width={14} height={14} />
        <span>Clear</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="clear-menu-popover"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
          >
            {WINDOWS.map((window) => (
              <button key={window.hours} onClick={() => void clearWindow(window.hours)}>
                {window.label}
              </button>
            ))}
            <div className="clear-menu-divider" />
            <button
              className={confirmAll ? "confirm" : ""}
              onClick={() => {
                if (!confirmAll) {
                  setConfirmAll(true);
                  return;
                }
                setOpen(false);
                void onClearAll();
              }}
            >
              {confirmAll ? "Click again to confirm" : scoped ? "Clear matching items" : "Clear all history"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
