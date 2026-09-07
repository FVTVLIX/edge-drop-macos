import { motion } from "framer-motion";
import { HotkeyRecorder } from "./HotkeyRecorder";
import { DisplayOption, SettingsData } from "../settings";

interface SettingsProps {
  settings: SettingsData;
  displays: DisplayOption[];
  onUpdate: (patch: Partial<SettingsData>) => void;
  onClose: () => void;
  onReset: () => void;
}

function SliderControl({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <label className="settings-control settings-slider-control">
      <span className="settings-control-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="settings-value">{displayValue}</span>
      <input
        className="settings-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--slider-fill": `${percentage}%` } as React.CSSProperties}
      />
    </label>
  );
}

function ToggleControl({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="settings-control settings-toggle-control">
      <span className="settings-control-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <button
        className={`settings-switch${value ? " enabled" : ""}`}
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
      >
        <motion.span
          animate={{ x: value ? 18 : 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 32 }}
        />
      </button>
    </div>
  );
}

function SettingsSection({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
      </div>
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function Settings({ settings, displays, onUpdate, onClose, onReset }: SettingsProps) {
  return (
    <motion.div
      className="settings-view"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.16 }}
    >
      <div className="settings-title-row">
        <div>
          <span>Edge Drop</span>
          <h2>Settings</h2>
        </div>
        <span className="settings-saved"><i /> Changes save automatically</span>
      </div>

      <div className="settings-scroll">
        <SettingsSection eyebrow="Activation" title="Edge trigger">
          <ToggleControl
            label="Hover activation"
            description="Open the shelf when the pointer reaches its trigger area. The shortcut always works."
            value={settings.hoverActivation}
            onChange={(hoverActivation) => onUpdate({ hoverActivation })}
          />
          <div className="settings-control settings-segment-control">
            <span className="settings-control-copy">
              <strong>Global toggle shortcut</strong>
              <small>Open or close the shelf from any application.</small>
            </span>
            <HotkeyRecorder value={settings.toggleHotkey} onChange={(toggleHotkey) => onUpdate({ toggleHotkey })} />
          </div>
          <SliderControl
            label="Trigger height"
            description="Vertical portion of the screen edge that opens the shelf."
            value={Math.round(settings.hotZoneHeight * 100)}
            min={10}
            max={100}
            step={5}
            displayValue={`${Math.round(settings.hotZoneHeight * 100)}%`}
            onChange={(value) => onUpdate({ hotZoneHeight: value / 100 })}
          />
          <SliderControl
            label="Edge thickness"
            description={`How close the pointer must be to the ${settings.edgePosition} edge.`}
            value={settings.hotZoneWidth}
            min={1}
            max={16}
            step={1}
            displayValue={`${settings.hotZoneWidth}px`}
            onChange={(hotZoneWidth) => onUpdate({ hotZoneWidth })}
          />
          <SliderControl
            label="Open delay"
            description="Pointer dwell time before the shelf appears."
            value={settings.openDelayMs}
            min={60}
            max={700}
            step={20}
            displayValue={`${settings.openDelayMs}ms`}
            onChange={(openDelayMs) => onUpdate({ openDelayMs })}
          />
          <SliderControl
            label="Close delay"
            description="Grace period after the pointer leaves the shelf."
            value={settings.closeDelayMs}
            min={100}
            max={1500}
            step={50}
            displayValue={`${settings.closeDelayMs}ms`}
            onChange={(closeDelayMs) => onUpdate({ closeDelayMs })}
          />
        </SettingsSection>

        <SettingsSection eyebrow="Layout" title="Shelf appearance">
          {displays.length > 1 && (
            <label className="settings-control settings-select-control">
              <span className="settings-control-copy">
                <strong>Display</strong>
                <small>Choose the screen whose edge holds the shelf.</small>
              </span>
              <select
                value={displays.some((display) => display.id === settings.displayId) ? settings.displayId : displays.find((display) => display.primary)?.id || displays[0].id}
                onChange={(event) => onUpdate({ displayId: event.target.value })}
              >
                {displays.map((display) => (
                  <option key={display.id} value={display.id}>{display.label}</option>
                ))}
              </select>
            </label>
          )}
          <div className="settings-control settings-segment-control">
            <span className="settings-control-copy">
              <strong>Screen edge</strong>
              <small>Choose which side holds the shelf and preview.</small>
            </span>
            <div className="settings-segmented">
              {(["left", "right"] as const).map((edgePosition) => (
                <button
                  key={edgePosition}
                  className={settings.edgePosition === edgePosition ? "selected" : ""}
                  onClick={() => onUpdate({ edgePosition })}
                >
                  {edgePosition === "left" ? "Left" : "Right"}
                </button>
              ))}
            </div>
          </div>
          <SliderControl
            label="Panel height"
            description="Visible height of the shelf when it is open."
            value={Math.round(settings.panelHeight * 100)}
            min={35}
            max={95}
            step={5}
            displayValue={`${Math.round(settings.panelHeight * 100)}%`}
            onChange={(value) => onUpdate({ panelHeight: value / 100 })}
          />
          <SliderControl
            label="Vertical position"
            description="Move the shelf from the top to the bottom of the selected edge."
            value={Math.round(settings.verticalOffset * 100)}
            min={0}
            max={100}
            step={5}
            displayValue={`${Math.round(settings.verticalOffset * 100)}%`}
            onChange={(value) => onUpdate({ verticalOffset: value / 100 })}
          />
          <div className="settings-control settings-segment-control">
            <span className="settings-control-copy">
              <strong>Trigger alignment</strong>
              <small>Align the hover strip within the shelf.</small>
            </span>
            <div className="settings-segmented">
              {(["top", "center", "bottom"] as const).map((triggerAlignment) => (
                <button
                  key={triggerAlignment}
                  className={settings.triggerAlignment === triggerAlignment ? "selected" : ""}
                  onClick={() => onUpdate({ triggerAlignment })}
                >
                  {triggerAlignment[0].toUpperCase() + triggerAlignment.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-control settings-segment-control">
            <span className="settings-control-copy">
              <strong>Card density</strong>
              <small>Compact mode fits more clipboard cards onscreen.</small>
            </span>
            <div className="settings-segmented">
              {(["modern", "compact"] as const).map((style) => (
                <button
                  key={style}
                  className={settings.uiStyle === style ? "selected" : ""}
                  onClick={() => onUpdate({ uiStyle: style })}
                >
                  {style === "modern" ? "Comfortable" : "Compact"}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-control settings-segment-control">
            <span className="settings-control-copy">
              <strong>Text size</strong>
              <small>Adjust shelf labels and controls for readability.</small>
            </span>
            <div className="settings-segmented">
              {([0.85, 1, 1.15] as const).map((fontSizeScale) => (
                <button
                  key={fontSizeScale}
                  className={settings.fontSizeScale === fontSizeScale ? "selected" : ""}
                  onClick={() => onUpdate({ fontSizeScale })}
                >
                  {fontSizeScale === 0.85 ? "Small" : fontSizeScale === 1 ? "Normal" : "Large"}
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection eyebrow="Drag & drop" title="Native drag preview">
          <SliderControl
            label="Preview size"
            description="Size of the translucent image shown under the pointer."
            value={settings.dragPreviewSize}
            min={40}
            max={128}
            step={4}
            displayValue={`${settings.dragPreviewSize}px`}
            onChange={(dragPreviewSize) => onUpdate({ dragPreviewSize })}
          />
          <div className="drag-preview-demo" aria-hidden="true">
            <div style={{ width: settings.dragPreviewSize, height: settings.dragPreviewSize }}>
              <img src="/logo.svg" alt="" />
            </div>
            <span>Actual maximum preview size</span>
          </div>
        </SettingsSection>

        <SettingsSection eyebrow="Storage" title="Clipboard history">
          <ToggleControl
            label="Move pasted items to top"
            description="Promote an item to the top of Recent after click-to-paste."
            value={settings.movePastedToTop}
            onChange={(movePastedToTop) => onUpdate({ movePastedToTop })}
          />
          <SliderControl
            label="History limit"
            description="Pinned cards are always preserved when older items are trimmed."
            value={settings.historyLimit}
            min={50}
            max={2000}
            step={50}
            displayValue={`${settings.historyLimit} items`}
            onChange={(historyLimit) => onUpdate({ historyLimit })}
          />
          <div className="settings-control settings-segment-control">
            <span className="settings-control-copy">
              <strong>Automatically delete</strong>
              <small>Expire unpinned history after this amount of time.</small>
            </span>
            <div className="settings-segmented">
              {([
                { value: 0, label: "Never" },
                { value: 1, label: "1h" },
                { value: 6, label: "6h" },
                { value: 24, label: "24h" },
                { value: 168, label: "7d" },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  className={settings.autoDeleteHours === option.value ? "selected" : ""}
                  onClick={() => onUpdate({ autoDeleteHours: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <ToggleControl
            label="Clear unpinned on restart"
            description="Start each session with only pinned items."
            value={settings.clearUnpinnedOnRestart}
            onChange={(clearUnpinnedOnRestart) => onUpdate({ clearUnpinnedOnRestart })}
          />
          <ToggleControl
            label="Pause clipboard capture"
            description="Ignore new clipboard content until capture is resumed."
            value={settings.incognito}
            onChange={(incognito) => onUpdate({ incognito })}
          />
        </SettingsSection>

        <SettingsSection eyebrow="Accessibility" title="Motion">
          <ToggleControl
            label="Reduce motion"
            description="Use immediate state changes and minimal transitions."
            value={settings.reduceMotion}
            onChange={(reduceMotion) => onUpdate({ reduceMotion })}
          />
          <ToggleControl
            label="Bounce animation"
            description="Add the original overshoot motion when the shelf opens."
            value={settings.bounceAnimation}
            onChange={(bounceAnimation) => onUpdate({ bounceAnimation })}
          />
        </SettingsSection>

        <SettingsSection eyebrow="Application" title="Edge Drop">
          <ToggleControl
            label="Launch at login"
            description="Start Edge Drop automatically when you sign in to this Mac."
            value={settings.launchAtLogin}
            onChange={(launchAtLogin) => onUpdate({ launchAtLogin })}
          />
          <div className="settings-control settings-segment-control">
            <span className="settings-control-copy">
              <strong>Quit Edge Drop</strong>
              <small>Stop clipboard capture and close the menu bar app.</small>
            </span>
            <button
              className="settings-reset"
              onClick={() => import("@tauri-apps/api/core").then(({ invoke }) => invoke("quit_app"))}
            >
              Quit
            </button>
          </div>
        </SettingsSection>
      </div>

      <div className="settings-footer">
        <button className="settings-reset" onClick={onReset}>Reset defaults</button>
        <button className="settings-done" onClick={onClose}>Done</button>
      </div>
    </motion.div>
  );
}
