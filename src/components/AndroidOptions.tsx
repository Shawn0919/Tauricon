import { useI18n, type MessageKey } from "../i18n";
import type { Condition, Layer, SourceInfo } from "../lib/api";
import { CloseIcon } from "./Icons";

export interface AndroidSettings {
  round: boolean;
  adaptive: boolean;
  /** Fraction of the 108dp adaptive canvas the artwork fills. */
  foregroundScale: number;
  /** Android 13+ themed icon layer. */
  monochrome: boolean;
}

export const DEFAULT_ANDROID_SETTINGS: AndroidSettings = {
  round: true,
  adaptive: true,
  foregroundScale: 0.61,
  monochrome: true,
};

/** Images loaded for individual adaptive layers. */
export type LayerSources = Partial<Record<Layer, SourceInfo>>;

/** Spec tags (crates/icon-core/presets/android.json) to skip for these settings. */
export function androidDisabledTags(settings: AndroidSettings): string[] {
  return [!settings.round && "round", !settings.adaptive && "adaptive"].filter(
    (tag): tag is string => !!tag,
  );
}

/** Spec scale overrides for these settings. */
export function androidScales(settings: AndroidSettings): Record<string, number> {
  return { android_foreground_scale: settings.foregroundScale };
}

/** Which spec conditions hold, mirroring `Layout::holds` in the engine. */
export function androidConditions(
  settings: AndroidSettings,
  layers: LayerSources,
  gradientBackground: boolean,
): Record<Condition, boolean> {
  const backgroundImage = !!layers.background || gradientBackground;
  return {
    background_image: backgroundImage,
    background_color: !backgroundImage,
    monochrome: settings.monochrome,
  };
}

interface Props {
  settings: AndroidSettings;
  layers: LayerSources;
  disabled: boolean;
  onChange: (patch: Partial<AndroidSettings>) => void;
  onPickLayer: (layer: Layer) => void;
  onClearLayer: (layer: Layer) => void;
}

export function AndroidOptions({ settings, layers, disabled, onChange, onPickLayer, onClearLayer }: Props) {
  const { t } = useI18n();

  return (
    <fieldset className="card-options" disabled={disabled}>
      <label className="field-row">
        <input
          type="checkbox"
          checked={settings.round}
          onChange={(e) => onChange({ round: e.target.checked })}
        />
        <span>{t("android.round")}</span>
      </label>
      <label className="field-row">
        <input
          type="checkbox"
          checked={settings.adaptive}
          onChange={(e) => onChange({ adaptive: e.target.checked })}
        />
        <span>{t("android.adaptive")}</span>
      </label>

      {settings.adaptive && (
        <div className="sub-field">
          <span className="sub-field-title">{t("android.layers")}</span>
          <LayerRow
            label="android.layer.foreground"
            fallback="android.layer.useMain"
            info={layers.foreground}
            onPick={() => onPickLayer("foreground")}
            onClear={() => onClearLayer("foreground")}
          />
          <LayerRow
            label="android.layer.background"
            fallback="android.layer.useStyle"
            info={layers.background}
            onPick={() => onPickLayer("background")}
            onClear={() => onClearLayer("background")}
          />

          <div className="card-option-slider">
            <label className="field-row" htmlFor="android-foreground-scale">
              <span>{t("android.foregroundScale")}</span>
              <span className="field-value">{Math.round(settings.foregroundScale * 100)}%</span>
            </label>
            <input
              id="android-foreground-scale"
              type="range"
              min={0.4}
              max={1}
              step={0.01}
              value={settings.foregroundScale}
              onChange={(e) => onChange({ foregroundScale: Number(e.target.value) })}
            />
            <p className="help">{t("android.foregroundScaleHelp")}</p>
          </div>

          <label className="field-row">
            <input
              type="checkbox"
              checked={settings.monochrome}
              onChange={(e) => onChange({ monochrome: e.target.checked })}
            />
            <span>{t("android.monochrome")}</span>
          </label>
          {settings.monochrome && (
            <>
              <LayerRow
                label="android.layer.monochrome"
                fallback="android.layer.auto"
                info={layers.monochrome}
                onPick={() => onPickLayer("monochrome")}
                onClear={() => onClearLayer("monochrome")}
              />
              <p className="help">{t("android.monochromeHelp")}</p>
            </>
          )}
          <p className="help">{t("android.legacyNote")}</p>
        </div>
      )}
    </fieldset>
  );
}

interface LayerRowProps {
  label: MessageKey;
  /** What the layer uses when no image is chosen. */
  fallback: MessageKey;
  info: SourceInfo | undefined;
  onPick: () => void;
  onClear: () => void;
}

function LayerRow({ label, fallback, info, onPick, onClear }: LayerRowProps) {
  const { t } = useI18n();
  return (
    <div className="layer-row">
      <span className="layer-label">{t(label)}</span>
      <span className={`layer-value ${info ? "" : "muted"}`} title={info?.path}>
        {info ? info.fileName : t(fallback)}
      </span>
      {info ? (
        <button
          type="button"
          className="icon-button"
          onClick={onClear}
          title={t("android.layer.clear")}
          aria-label={t("android.layer.clear")}
        >
          <CloseIcon width={14} height={14} />
        </button>
      ) : (
        <button type="button" className="link-button" onClick={onPick}>
          {t("android.layer.choose")}
        </button>
      )}
    </div>
  );
}
