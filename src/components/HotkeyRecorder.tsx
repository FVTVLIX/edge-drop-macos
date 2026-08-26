import { useCallback, useEffect, useState } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

function badges(value: string): string[] {
  return value.split("+").map((part) => {
    if (part === "Super" || part === "CmdOrCtrl") return "⌘";
    if (part === "Alt") return "⌥";
    if (part === "Shift") return "⇧";
    if (part === "Control") return "⌃";
    return part.replace(/^Key/, "").replace(/^Digit/, "");
  });
}

function accelerator(event: KeyboardEvent): string | null {
  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push("Super");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  const modifierKey = ["Meta", "Control", "Alt", "Shift"].includes(event.key);
  if (modifierKey) return null;
  let code = event.code;
  if (!/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Tab|Enter|Backspace|Arrow(?:Up|Down|Left|Right))$/.test(code)) {
    return null;
  }
  if (modifiers.length === 0 && !/^F(?:[1-9]|1[0-2])$/.test(code)) return null;
  return [...modifiers, code].join("+");
}

export function HotkeyRecorder({ value, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const pause = useCallback((paused: boolean) => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_hotkey_paused", { paused }))
      .catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    setRecording(false);
    pause(false);
  }, [pause]);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        stop();
        return;
      }
      const next = accelerator(event);
      if (next) {
        onChange(next);
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      pause(false);
    };
  }, [recording, onChange, pause, stop]);

  return (
    <div className={`hotkey-recorder${recording ? " recording" : ""}`}>
      <button
        type="button"
        className="hotkey-field"
        onClick={() => {
          if (!recording) {
            pause(true);
            setRecording(true);
          }
        }}
      >
        <span className="hotkey-badges">
          {recording ? <em>Press shortcut…</em> : badges(value).map((badge, index) => <kbd key={`${badge}-${index}`}>{badge}</kbd>)}
        </span>
        <small>{recording ? "Esc to cancel" : "Edit"}</small>
      </button>
      {value !== "Alt+KeyC" && !recording && (
        <button type="button" className="hotkey-reset" onClick={() => onChange("Alt+KeyC")}>Reset</button>
      )}
    </div>
  );
}
