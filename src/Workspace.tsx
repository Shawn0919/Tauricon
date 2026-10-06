import { useEffect, useMemo, useRef, useState } from "react";
import { dirname, join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  generateIcons,
  listPlatforms,
  loadSource,
  SUPPORTED_EXTENSIONS,
  type OutputTarget,
  type PlatformInfo,
  type SourceInfo,
} from "./lib/api";
import { hexToColor } from "./lib/color";
import { describeError } from "./lib/errors";
import { hasModKey } from "./lib/platform";
import { useI18n } from "./i18n";
import { usePersistentState } from "./hooks/usePersistentState";
import { usePreview } from "./hooks/usePreview";
import { useFileDrop } from "./hooks/useFileDrop";
import { DropZone } from "./components/DropZone";
import { OutputOptions } from "./components/OutputOptions";
import { PreviewGallery } from "./components/PreviewGallery";
import { groupPlatforms, PlatformPicker } from "./components/PlatformPicker";
import { ExportBar, type ExportStatus } from "./components/ExportBar";
import { WarningIcon } from "./components/Icons";
import type { Preferences } from "./components/SettingsDialog";
import {
  AndroidOptions,
  androidDisabledTags,
  androidScales,
  DEFAULT_ANDROID_SETTINGS,
  type AndroidSettings,
} from "./components/AndroidOptions";
import { PresetMenu, type PlatformPreset } from "./components/PresetMenu";
import { RecentFiles } from "./components/RecentFiles";
import { formatOutputName } from "./lib/fileName";

export const SETTINGS_STORAGE_KEY = "settings.v1";

interface Settings {
  /** Selected base platform ids; null until changed, meaning "all platforms". */
  platforms: string[] | null;
  /** Chosen variant per base platform id (e.g. { ios: "ios-single" }). */
  variants: Record<string, string>;
  fillBackground: boolean;
  backgroundHex: string;
  padding: number;
  optimizePng: boolean;
  outputKind: OutputTarget["kind"];
  /** Folder of the last export, used as the dialogs' starting point. */
  lastOutputDir: string | null;
  android: AndroidSettings;
  platformPresets: PlatformPreset[];
  /** Most recent first. Plain paths: on macOS (sandboxed) these will need
   *  security-scoped bookmarks to reopen across launches. */
  recentFiles: string[];
}

const DEFAULT_SETTINGS: Settings = {
  platforms: null,
  variants: {},
  fillBackground: false,
  backgroundHex: "#FFFFFF",
  padding: 0,
  optimizePng: false,
  outputKind: "zip",
  lastOutputDir: null,
  android: DEFAULT_ANDROID_SETTINGS,
  platformPresets: [],
  recentFiles: [],
};

const MAX_RECENT_FILES = 6;

interface Props {
  preferences: Preferences;
}

/** Main working area: source, options, preview, platforms and export. */
export function Workspace({ preferences }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = usePersistentState<Settings>(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourceError, setSourceError] = useState<unknown>(null);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });

  useEffect(() => {
    listPlatforms().then(setPlatforms);
  }, []);

  const backgroundHex = settings.fillBackground ? settings.backgroundHex : null;
  const preview = usePreview(source, backgroundHex, settings.padding);

  const families = useMemo(() => groupPlatforms(platforms), [platforms]);
  // Base ids in the backend's display order, regardless of click order.
  const selectedIds = families
    .map((f) => f.base.id)
    .filter((id) => settings.platforms === null || settings.platforms.includes(id));
  // The concrete platform (base or chosen variant) generated for each selection.
  const outputs = families
    .filter((f) => selectedIds.includes(f.base.id))
    .map((f) => f.variants.find((v) => v.id === settings.variants[f.base.id]) ?? f.base);
  const disabledTags = androidDisabledTags(settings.android);
  const countFiles = (p: PlatformInfo) =>
    p.fileCount - disabledTags.reduce((sum, tag) => sum + (p.tagCounts[tag] ?? 0), 0);
  const fileCount = outputs.reduce((sum, p) => sum + countFiles(p), 0);

  const blockedReason = !source
    ? t("export.blocked.noSource")
    : outputs.length === 0
      ? t("export.blocked.noPlatforms")
      : null;

  async function load(path: string) {
    setLoading(true);
    setSourceError(null);
    setStatus({ kind: "idle" });
    try {
      setSource(await loadSource(path));
      setSettings((s) => ({
        ...s,
        recentFiles: [path, ...s.recentFiles.filter((p) => p !== path)].slice(0, MAX_RECENT_FILES),
      }));
    } catch (err) {
      setSourceError(err);
      // Drop entries that no longer open (moved or deleted files).
      setSettings((s) => ({ ...s, recentFiles: s.recentFiles.filter((p) => p !== path) }));
    } finally {
      setLoading(false);
    }
  }

  const dragging = useFileDrop(load);

  async function pickFile() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t("dialog.imageFilter"), extensions: SUPPORTED_EXTENSIONS }],
    });
    if (path) await load(path);
  }

  /** Asks where to save; returns the target and the folder to remember. */
  async function chooseTarget(baseName: string): Promise<{ target: OutputTarget; dir: string } | null> {
    const startDir = preferences.rememberOutputDir ? settings.lastOutputDir : null;

    if (settings.outputKind === "zip") {
      const fileName = `${baseName}.zip`;
      const path = await save({
        defaultPath: startDir ? await join(startDir, fileName) : fileName,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      return path ? { target: { kind: "zip", path }, dir: await dirname(path) } : null;
    }

    const dir = await open({
      directory: true,
      defaultPath: startDir ?? undefined,
      title: t("dialog.folderTitle", { name: baseName }),
    });
    if (!dir) return null;
    // Write into a subfolder so platform folders don't scatter over e.g. the Desktop.
    return { target: { kind: "folder", path: await join(dir, baseName) }, dir };
  }

  async function generate() {
    if (!source || blockedReason || status.kind === "running") return;

    const baseName = formatOutputName(preferences.fileNameTemplate, source.fileName);
    const choice = await chooseTarget(baseName);
    if (!choice) return;
    if (preferences.rememberOutputDir) update({ lastOutputDir: choice.dir });

    setStatus({ kind: "running", progress: { done: 0, total: 1 } });
    try {
      const report = await generateIcons(
        {
          platforms: outputs.map((p) => p.id),
          background: backgroundHex ? hexToColor(backgroundHex) : null,
          padding: settings.padding,
          optimizePng: settings.optimizePng,
          disabledTags,
          scales: androidScales(settings.android),
        },
        choice.target,
        (progress) => setStatus({ kind: "running", progress }),
      );
      setStatus({ kind: "done", report });
      if (preferences.revealAfterExport) revealItemInDir(report.outputPath);
    } catch (err) {
      setStatus({ kind: "error", error: err });
    }
  }

  // Shortcuts read the latest handlers through a ref instead of re-subscribing.
  const shortcuts = useRef({ pickFile, generate });
  shortcuts.current = { pickFile, generate };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!hasModKey(event)) return;
      // Leave shortcuts alone while a modal (e.g. Settings) is open.
      if (document.querySelector("dialog[open]")) return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        shortcuts.current.pickFile();
      } else if (event.key === "Enter") {
        event.preventDefault();
        shortcuts.current.generate();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Stored as raw errors so messages re-translate when the language changes.
  const visibleError = sourceError ?? preview.error;

  return (
    <>
      <div className="app-body">
        <aside className="sidebar">
          <DropZone
            source={source}
            previewUrl={preview.url}
            dragging={dragging}
            loading={loading}
            onPick={pickFile}
          />
          <RecentFiles
            paths={settings.recentFiles}
            currentPath={source?.path ?? null}
            onOpen={load}
            onClear={() => update({ recentFiles: [] })}
          />
          {visibleError != null && (
            <div className="warning is-error" role="alert">
              <WarningIcon width={14} height={14} />
              {describeError(visibleError, t).message}
            </div>
          )}
          <OutputOptions
            fillBackground={settings.fillBackground}
            backgroundHex={settings.backgroundHex}
            padding={settings.padding}
            optimizePng={settings.optimizePng}
            onFillChange={(fillBackground) => update({ fillBackground })}
            onBackgroundChange={(backgroundHex) => update({ backgroundHex })}
            onPaddingChange={(padding) => update({ padding })}
            onOptimizePngChange={(optimizePng) => update({ optimizePng })}
          />
        </aside>

        <main className="content">
          <PreviewGallery previewUrl={preview.url} platformIds={selectedIds} />
          <PlatformPicker
            families={families}
            selected={selectedIds}
            variants={settings.variants}
            onChange={(ids) => update({ platforms: ids })}
            onVariantChange={(baseId, variantId) =>
              update({ variants: { ...settings.variants, [baseId]: variantId } })
            }
            countFiles={countFiles}
            renderExtras={(baseId, checked) =>
              baseId === "android" && (
                <AndroidOptions
                  settings={settings.android}
                  disabled={!checked}
                  onChange={(patch) => update({ android: { ...settings.android, ...patch } })}
                />
              )
            }
            headerExtra={
              <PresetMenu
                presets={settings.platformPresets}
                onApply={(preset) => update({ platforms: preset.platforms, variants: preset.variants })}
                onSave={(name) =>
                  update({
                    platformPresets: [
                      ...settings.platformPresets,
                      {
                        id: crypto.randomUUID(),
                        name,
                        platforms: selectedIds,
                        variants: settings.variants,
                      },
                    ],
                  })
                }
                onDelete={(id) =>
                  update({ platformPresets: settings.platformPresets.filter((p) => p.id !== id) })
                }
              />
            }
          />
        </main>
      </div>

      <ExportBar
        outputKind={settings.outputKind}
        onOutputKindChange={(outputKind) => update({ outputKind })}
        fileCount={fileCount}
        blockedReason={blockedReason}
        status={status}
        onGenerate={generate}
        onReveal={(path) => revealItemInDir(path)}
        onDismiss={() => setStatus({ kind: "idle" })}
      />

      {dragging && <div className="drop-overlay">{t("dropzone.overlay")}</div>}
    </>
  );
}
