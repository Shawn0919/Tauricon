import { useI18n } from "../i18n";
import type { Background } from "../lib/api";
import { hexToColor } from "../lib/color";

export type BackgroundMode = "none" | "solid" | "gradient";

export interface StyleSettings {
  backgroundMode: BackgroundMode;
  backgroundHex: string;
  gradientFrom: string;
  gradientTo: string;
  /** CSS-style degrees (180 = top→bottom). */
  gradientAngle: number;
  padding: number;
  cornerRadius: number;
  macosTemplate: boolean;
}

export const DEFAULT_STYLE: StyleSettings = {
  backgroundMode: "none",
  backgroundHex: "#FFFFFF",
  gradientFrom: "#6366F1",
  gradientTo: "#EC4899",
  gradientAngle: 135,
  padding: 0,
  cornerRadius: 0,
  macosTemplate: false,
};

/** The engine's background value for these settings. */
export function toBackground(style: StyleSettings): Background | null {
  const color = (hex: string) => hexToColor(hex) ?? { r: 255, g: 255, b: 255 };
  switch (style.backgroundMode) {
    case "solid":
      return { type: "solid", color: color(style.backgroundHex) };
    case "gradient":
      return {
        type: "linearGradient",
        from: color(style.gradientFrom),
        to: color(style.gradientTo),
        angle: style.gradientAngle,
      };
    default:
      return null;
  }
}

const MODES = [
  { value: "none", label: "style.background.none" },
  { value: "solid", label: "style.background.solid" },
  { value: "gradient", label: "style.background.gradient" },
] as const;

interface Props {
  style: StyleSettings;
  onChange: (patch: Partial<StyleSettings>) => void;
}

export function StylePanel({ style, onChange }: Props) {
  const { t } = useI18n();

  return (
    <section className="panel">
      <h2>{t("style.title")}</h2>

      <div className="field">
        <div className="field-row">
          <span>{t("style.background")}</span>
          <div
            className="segmented segmented-small field-value"
            role="radiogroup"
            aria-label={t("style.background")}
          >
            {MODES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={style.backgroundMode === value}
                className={style.backgroundMode === value ? "is-active" : ""}
                onClick={() => onChange({ backgroundMode: value })}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        {style.backgroundMode === "solid" && (
          <div className="field-row sub-field">
            <ColorInput
              label={t("options.backgroundColor")}
              value={style.backgroundHex}
              onChange={(backgroundHex) => onChange({ backgroundHex })}
            />
          </div>
        )}

        {style.backgroundMode === "gradient" && (
          <div className="sub-field">
            <div className="field-row">
              <ColorInput
                label={t("style.gradientFrom")}
                value={style.gradientFrom}
                onChange={(gradientFrom) => onChange({ gradientFrom })}
              />
              <button
                type="button"
                className="icon-button"
                title={t("style.swapColors")}
                aria-label={t("style.swapColors")}
                onClick={() =>
                  onChange({ gradientFrom: style.gradientTo, gradientTo: style.gradientFrom })
                }
              >
                ⇄
              </button>
              <ColorInput
                label={t("style.gradientTo")}
                value={style.gradientTo}
                onChange={(gradientTo) => onChange({ gradientTo })}
              />
            </div>
            <Slider
              id="gradient-angle"
              label={t("style.gradientAngle")}
              display={`${style.gradientAngle}°`}
              min={0}
              max={360}
              step={15}
              value={style.gradientAngle}
              onChange={(gradientAngle) => onChange({ gradientAngle })}
            />
          </div>
        )}
        <p className="help">{t("options.fillHelp")}</p>
      </div>

      <div className="field">
        <Slider
          id="padding"
          label={t("options.padding")}
          display={`${Math.round(style.padding * 100)}%`}
          min={0}
          max={0.4}
          step={0.01}
          value={style.padding}
          onChange={(padding) => onChange({ padding })}
        />
      </div>

      <div className="field">
        <Slider
          id="corner-radius"
          label={t("style.cornerRadius")}
          display={`${Math.round(style.cornerRadius * 100)}%`}
          min={0}
          max={0.5}
          step={0.01}
          value={style.cornerRadius}
          onChange={(cornerRadius) => onChange({ cornerRadius })}
        />
        <p className="help">{t("style.cornerRadiusHelp")}</p>
      </div>

      <div className="field">
        <label className="field-row">
          <input
            type="checkbox"
            checked={style.macosTemplate}
            onChange={(e) => onChange({ macosTemplate: e.target.checked })}
          />
          <span>{t("style.macosTemplate")}</span>
        </label>
        <p className="help">{t("style.macosTemplateHelp")}</p>
      </div>
    </section>
  );
}

function ColorInput(props: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="color-field">
      <input
        type="color"
        className="color-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value.toUpperCase())}
        aria-label={props.label}
      />
      <span className="color-field-text">
        <span className="muted">{props.label}</span>
        <code>{props.value}</code>
      </span>
    </label>
  );
}

interface SliderProps {
  id: string;
  label: string;
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

function Slider({ id, label, display, min, max, step, value, onChange }: SliderProps) {
  return (
    <>
      <label className="field-row" htmlFor={id}>
        <span>{label}</span>
        <span className="field-value">{display}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </>
  );
}
