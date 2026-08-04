import { motion } from "framer-motion";
import { SettingsData } from "../settings";

interface SettingsProps {
  settings: SettingsData;
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

export function Settings({ settings, onUpdate, onClose, onReset }: SettingsProps) {
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
          <span>Edge-Drop</span>
          <h2>Settings</h2>
        </div>
        <span className="settings-saved"><i /> Changes save automatically</span>
      </div>

      <div className="settings-scroll">
        <SettingsSection eyebrow="Activation" title="Edge trigger">
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
            description="How close the pointer must be to the left edge."
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
        </SettingsSection>
      </div>

      <div className="settings-footer">
        <button className="settings-reset" onClick={onReset}>Reset defaults</button>
        <button className="settings-done" onClick={onClose}>Done</button>
      </div>
    </motion.div>
  );
}
