import type { ReactNode } from "react";
import { isMessageKey, useI18n } from "../i18n";
import type { PlatformInfo } from "../lib/api";
import { platformDescriptionKey } from "../lib/platformMeta";

/** A base platform plus its alternative outputs (the base is always first). */
export interface PlatformFamily {
  base: PlatformInfo;
  variants: PlatformInfo[];
}

export function groupPlatforms(platforms: PlatformInfo[]): PlatformFamily[] {
  return platforms
    .filter((p) => !p.variantOf)
    .map((base) => ({
      base,
      variants: [base, ...platforms.filter((p) => p.variantOf === base.id)],
    }));
}

interface Props {
  families: PlatformFamily[];
  /** Selected base platform ids. */
  selected: string[];
  /** Chosen variant id per base id; missing means the base itself. */
  variants: Record<string, string>;
  onChange: (selected: string[]) => void;
  onVariantChange: (baseId: string, variantId: string) => void;
  /** Files a platform will produce with the current options. */
  countFiles: (platform: PlatformInfo) => number;
  /** Extra controls rendered inside a platform's card. */
  renderExtras?: (baseId: string, checked: boolean) => ReactNode;
  /** Extra controls in the panel header (e.g. presets). */
  headerExtra?: ReactNode;
}

export function PlatformPicker(props: Props) {
  const { families, selected, variants, onChange, onVariantChange, countFiles } = props;
  const { t } = useI18n();
  const allSelected = families.length > 0 && families.every((f) => selected.includes(f.base.id));

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{t("platforms.title")}</h2>
        <div className="panel-actions">
          {props.headerExtra}
          <button
            type="button"
            className="link-button"
            onClick={() => onChange(allSelected ? [] : families.map((f) => f.base.id))}
          >
            {allSelected ? t("platforms.selectNone") : t("platforms.selectAll")}
          </button>
        </div>
      </div>
      <div className="platform-grid">
        {families.map(({ base, variants: options }) => {
          const checked = selected.includes(base.id);
          const description = platformDescriptionKey(base.id);
          const active = options.find((v) => v.id === variants[base.id]) ?? base;
          return (
            <div key={base.id} className={`platform-card ${checked ? "is-checked" : ""}`}>
              <label className="platform-main">
                <input type="checkbox" checked={checked} onChange={() => toggle(base.id)} />
                <span className="platform-text">
                  <span className="platform-name">
                    {base.name}
                    <span className="badge">
                      {t("platforms.fileCount", { count: countFiles(active) })}
                    </span>
                  </span>
                  {description && <span className="muted">{t(description)}</span>}
                </span>
              </label>
              {options.length > 1 && (
                <div className="segmented segmented-small" role="radiogroup" aria-label={base.name}>
                  {options.map((option) => {
                    const key = `variant.${option.id}`;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={active.id === option.id}
                        className={active.id === option.id ? "is-active" : ""}
                        onClick={() => onVariantChange(base.id, option.id)}
                      >
                        {isMessageKey(key) ? t(key) : option.id}
                      </button>
                    );
                  })}
                </div>
              )}
              {props.renderExtras?.(base.id, checked)}
            </div>
          );
        })}
      </div>
    </section>
  );
}
