import { useEffect, useMemo, useRef, useState } from "react";
import { dirname, join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  generateIcons,
  listPlatforms,
  loadSource,
  loadLayer,
  clearLayer,
  SUPPORTED_EXTENSIONS,
  type OutputTarget,
  type PlatformInfo,
  type Layer,
  type SourceInfo,
  type StyleOptions,
} from "./lib/api";
import { describeError } from "./lib/errors";
import { hasModKey } from "./lib/platform";
import { useI18n } from "./i18n";
import { usePersistentState } from "./hooks/usePersistentState";
import { usePreview } from "./hooks/usePreview";
import { useFileDrop } from "./hooks/useFileDrop";
import { DropZone } from "./components/DropZone";
import { OutputOptions } from "./components/OutputOptions";
import { DEFAULT_STYLE, StylePanel, toBackground, type StyleSettings } from "./components/StylePanel";
import { PreviewGallery } from "./components/PreviewGallery";
import { groupPlatforms, PlatformPicker } from "./components/PlatformPicker";
import { ExportBar, type ExportStatus } from "./components/ExportBar";
import { WarningIcon } from "./components/Icons";
import type { Preferences } from "./components/SettingsDialog";
import {
  AndroidOptions,
  androidConditions,
  androidDisabledTags,
  androidScales,
  DEFAULT_ANDROID_SETTINGS,
  type AndroidSettings,
  type LayerSources,
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
  style: StyleSettings;
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
  style: DEFAULT_STYLE,
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
  const [layers, setLayers] = useState<LayerSources>({});
  // Bumped whenever layer images change so previews re-render.
  const [layerRevision, setLayerRevision] = useState(0);

  useEffect(() => {
    listPlatforms().then(setPlatforms);
  }, []);

  // Stored settings from older versions may lack newer fields.
  const android: AndroidSettings = { ...DEFAULT_ANDROID_SETTINGS, ...settings.android };
  const styleSettings: StyleSettings = { ...DEFAULT_STYLE, ...settings.style };

  const families = useMemo(() => groupPlatforms(platforms), [platforms]);
  // Base ids in the backend's display order, regardless of click order.
  const selectedIds = families
    .map((f) => f.base.id)
    .filter((id) => settings.platforms === null || settings.platforms.includes(id));
  // The concrete platform (base or chosen variant) generated for each selection.
  const outputs = families
    .filter((f) => selectedIds.includes(f.base.id))
    .map((f) => f.variants.find((v) => v.id === settings.variants[f.base.id]) ?? f.base);
  const style: StyleOptions = {
    background: toBackground(styleSettings),
    padding: styleSettings.padding,
    cornerRadius: styleSettings.cornerRadius,
    macosTemplate: styleSettings.macosTemplate,
    scales: androidScales(android),
  };
  const androidSelected = selectedIds.includes("android");
  const preview = usePreview(source, style, { kind: "plain" });
  const macPreview = usePreview(
    source,
    style,
    { kind: "platform", id: "macos" },
    { enabled: selectedIds.includes("macos") },
  );
  // Windows and Web share the "custom" shape; either one's preview works.
  const customPreview = usePreview(
    source,
    style,
    { kind: "platform", id: "windows" },
    { enabled: selectedIds.includes("windows") || selectedIds.includes("web") },
  );
  const adaptivePreview = usePreview(
    source,
    style,
    { kind: "androidAdaptive" },
    { enabled: androidSelected && android.adaptive, revision: layerRevision },
  );
  const monochromePreview = usePreview(
    source,
    style,
    { kind: "androidMonochrome" },
    {
      enabled: androidSelected && android.adaptive && android.monochrome,
      revision: layerRevision,
    },
  );

  const disabledTags = androidDisabledTags(android);
  const conditions = androidConditions(
    android,
    layers,
    style.background?.type === "linearGradient",
  );
  const countFiles = (p: PlatformInfo) =>
    p.fileCount -
    p.optionalFiles.filter(
      (f) => (f.tag !== null && disabledTags.includes(f.tag)) || (f.when !== null && !conditions[f.when]),
    ).length;
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
          ...style,
          optimizePng: settings.optimizePng,
          disabledTags,
          monochrome: android.adaptive && android.monochrome,
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

  async function pickLayer(layer: Layer) {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t("dialog.imageFilter"), extensions: SUPPORTED_EXTENSIONS }],
    });
    if (!path) return;
    setSourceError(null);
    try {
      const info = await loadLayer(layer, path);
      setLayers((current) => ({ ...current, [layer]: info }));
      setLayerRevision((r) => r + 1);
    } catch (err) {
      setSourceError(err);
    }
  }

  async function resetLayer(layer: Layer) {
    await clearLayer(layer);
    setLayers(({ [layer]: _removed, ...rest }) => rest);
    setLayerRevision((r) => r + 1);
  }

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
          <StylePanel
            style={styleSettings}
            onChange={(patch) => update({ style: { ...styleSettings, ...patch } })}
          />
          <OutputOptions
            optimizePng={settings.optimizePng}
            onOptimizePngChange={(optimizePng) => update({ optimizePng })}
          />
        </aside>

        <main className="content">
          <PreviewGallery
            previews={{
              base: preview.url,
              macos: macPreview.url,
              custom: customPreview.url,
              adaptive: adaptivePreview.url,
              monochrome: monochromePreview.url,
            }}
            platformIds={selectedIds}
          />
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
                  settings={android}
                  layers={layers}
                  disabled={!checked}
                  onChange={(patch) => update({ android: { ...android, ...patch } })}
                  onPickLayer={pickLayer}
                  onClearLayer={resetLayer}
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
