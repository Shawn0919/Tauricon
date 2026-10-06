import { useEffect, useState } from "react";
import { I18nProvider, resolveLocale, useI18n } from "./i18n";
import { usePersistentState } from "./hooks/usePersistentState";
import { useTheme, type ResolvedTheme } from "./hooks/useTheme";
import { DEFAULT_PREFERENCES, SettingsDialog, type Preferences } from "./components/SettingsDialog";
import { GearIcon, LogoIcon, MoonIcon, SunIcon } from "./components/Icons";
import { SETTINGS_STORAGE_KEY, Workspace } from "./Workspace";
import { IMAGE_SETS_STORAGE_KEY, ImageSetWorkspace } from "./ImageSetWorkspace";
import "./App.css";

const PREFERENCES_STORAGE_KEY = "preferences.v1";
const UI_STORAGE_KEY = "ui.v1";

type Mode = "icons" | "imageSets";

const MODES = [
  { value: "icons", label: "mode.icons" },
  { value: "imageSets", label: "mode.imageSets" },
] as const;

/** App shell: preferences (theme, language), mode, header and settings dialog. */
function App() {
  const [preferences, setPreferences] = usePersistentState<Preferences>(
    PREFERENCES_STORAGE_KEY,
    DEFAULT_PREFERENCES,
  );
  const updatePreferences = (patch: Partial<Preferences>) =>
    setPreferences((p) => ({ ...p, ...patch }));
  const [ui, setUi] = usePersistentState<{ mode: Mode }>(UI_STORAGE_KEY, { mode: "icons" });

  const theme = useTheme(preferences.theme);
  const locale = resolveLocale(preferences.language);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <div className="app">
        <Header
          mode={ui.mode}
          onModeChange={(mode) => setUi({ mode })}
          theme={theme}
          onToggleTheme={() => updatePreferences({ theme: theme === "dark" ? "light" : "dark" })}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {ui.mode === "imageSets" ? (
          <ImageSetWorkspace preferences={preferences} />
        ) : (
          <Workspace preferences={preferences} />
        )}
      </div>
      <SettingsDialog
        open={settingsOpen}
        preferences={preferences}
        onChange={updatePreferences}
        onReset={resetAllSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </I18nProvider>
  );
}

function resetAllSettings() {
  const keys = [PREFERENCES_STORAGE_KEY, SETTINGS_STORAGE_KEY, IMAGE_SETS_STORAGE_KEY, UI_STORAGE_KEY];
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  // Reloading re-reads every default cleanly; nothing in the session is worth keeping.
  window.location.reload();
}

interface HeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

function Header({ mode, onModeChange, theme, onToggleTheme, onOpenSettings }: HeaderProps) {
  const { t } = useI18n();
  const themeLabel = theme === "dark" ? t("header.theme.toLight") : t("header.theme.toDark");

  return (
    <header className="app-header">
      <LogoIcon />
      <h1>
        Tauricon <span className="app-subtitle">App Icon Generator</span>
      </h1>
      <div className="segmented header-modes" role="tablist" aria-label={t("mode.label")}>
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? "is-active" : ""}
            onClick={() => onModeChange(value)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="header-actions">
        <button type="button" className="icon-button" onClick={onToggleTheme} title={themeLabel} aria-label={themeLabel}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onOpenSettings}
          title={t("header.settings")}
          aria-label={t("header.settings")}
        >
          <GearIcon />
        </button>
      </div>
    </header>
  );
}

export default App;
