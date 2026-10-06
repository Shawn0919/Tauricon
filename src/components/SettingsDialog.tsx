import { useEffect, useRef } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { LOCALES, useI18n } from "../i18n";
import type { ThemePreference } from "../hooks/useTheme";
import { DEFAULT_NAME_TEMPLATE, formatOutputName } from "../lib/fileName";

export interface Preferences {
  theme: ThemePreference;
  /** "system" or a locale code from src/locales. */
  language: string;
  revealAfterExport: boolean;
  rememberOutputDir: boolean;
  /** ZIP/folder name; supports {name}, {date}, {time}. */
  fileNameTemplate: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  language: "system",
  revealAfterExport: false,
  rememberOutputDir: true,
  fileNameTemplate: DEFAULT_NAME_TEMPLATE,
};

interface Props {
  open: boolean;
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
  /** Called after the user confirms resetting everything. */
  onReset: () => void;
  onClose: () => void;
}

const THEMES = [
  { value: "system", label: "settings.theme.system" },
  { value: "light", label: "settings.theme.light" },
  { value: "dark", label: "settings.theme.dark" },
] as const;

export function SettingsDialog({ open, preferences, onChange, onReset, onClose }: Props) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);

  // A native modal <dialog> gives focus trapping and Esc-to-close for free.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  async function confirmReset() {
    const confirmed = await ask(t("settings.resetConfirm"), {
      title: t("settings.resetConfirmTitle"),
      kind: "warning",
    });
    if (confirmed) onReset();
  }

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) closes it.
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="settings-body">
        <h2>{t("settings.title")}</h2>

        <section className="settings-section">
          <h3>{t("settings.appearance")}</h3>
          <div className="settings-row">
            <span className="settings-label">{t("settings.appearance")}</span>
            <div className="segmented" role="radiogroup" aria-label={t("settings.appearance")}>
              {THEMES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={preferences.theme === value}
                  className={preferences.theme === value ? "is-active" : ""}
                  onClick={() => onChange({ theme: value })}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <label className="settings-label" htmlFor="language">
              {t("settings.language")}
            </label>
            <select
              id="language"
              className="select"
              value={preferences.language}
              onChange={(e) => onChange({ language: e.target.value })}
            >
              <option value="system">{t("settings.language.system")}</option>
              {LOCALES.map((locale) => (
                <option key={locale.code} value={locale.code}>
                  {locale.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="settings-section">
          <h3>{t("settings.output")}</h3>
          <div className="settings-field">
            <label className="settings-label" htmlFor="file-name-template">
              {t("settings.fileName")}
            </label>
            <input
              id="file-name-template"
              className="text-input"
              value={preferences.fileNameTemplate}
              placeholder={DEFAULT_NAME_TEMPLATE}
              spellCheck={false}
              onChange={(e) => onChange({ fileNameTemplate: e.target.value })}
            />
            <p className="help">
              {t("settings.fileNameHelp")}
              <br />
              {t("settings.fileNameExample", {
                example: `${formatOutputName(preferences.fileNameTemplate, "logo.png")}.zip`,
              })}
            </p>
          </div>
          <label className="field-row">
            <input
              type="checkbox"
              checked={preferences.revealAfterExport}
              onChange={(e) => onChange({ revealAfterExport: e.target.checked })}
            />
            <span>{t("settings.revealAfterExport")}</span>
          </label>
          <label className="field-row">
            <input
              type="checkbox"
              checked={preferences.rememberOutputDir}
              onChange={(e) => onChange({ rememberOutputDir: e.target.checked })}
            />
            <span>{t("settings.rememberOutputDir")}</span>
          </label>
        </section>

        <div className="settings-actions">
          <button type="button" className="danger-button" onClick={confirmReset}>
            {t("settings.reset")}
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            {t("settings.done")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
