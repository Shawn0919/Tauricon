import { useI18n } from "../i18n";

export interface AndroidSettings {
  round: boolean;
  adaptive: boolean;
  /** Fraction of the 108dp adaptive canvas the artwork fills. */
  foregroundScale: number;
}

export const DEFAULT_ANDROID_SETTINGS: AndroidSettings = {
  round: true,
  adaptive: true,
  foregroundScale: 0.61,
};

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

interface Props {
  settings: AndroidSettings;
  disabled: boolean;
  onChange: (patch: Partial<AndroidSettings>) => void;
}

export function AndroidOptions({ settings, disabled, onChange }: Props) {
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
      )}
    </fieldset>
  );
}
