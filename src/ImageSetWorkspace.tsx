import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  describeImage,
  generateImageSets,
  SUPPORTED_EXTENSIONS,
  type OutputTarget,
  type SourceInfo,
} from "./lib/api";
import { describeError } from "./lib/errors";
import { formatOutputName } from "./lib/fileName";
import { chooseOutputTarget } from "./lib/output";
import { modKey } from "./lib/platform";
import { useI18n } from "./i18n";
import { usePersistentState } from "./hooks/usePersistentState";
import { useFileDrop } from "./hooks/useFileDrop";
import { useShortcuts } from "./hooks/useShortcuts";
import { useThumbnail } from "./hooks/useThumbnail";
import { ExportBar, type ExportStatus } from "./components/ExportBar";
import { CloseIcon, UploadIcon, WarningIcon } from "./components/Icons";
import type { Preferences } from "./components/SettingsDialog";

export const IMAGE_SETS_STORAGE_KEY = "imageSets.v1";

interface Settings {
  ios: boolean;
  android: boolean;
  optimizePng: boolean;
  outputKind: OutputTarget["kind"];
  lastOutputDir: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  ios: true,
  android: true,
  optimizePng: false,
  outputKind: "zip",
  lastOutputDir: null,
};

/** Files per image for each target (iOS: 3 scales + Contents.json). */
const IOS_FILES = 4;
const ANDROID_FILES = 5;
const IOS_SCALES = [1, 2, 3];
const ANDROID_DENSITIES: [string, number][] = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

interface Item {
  info: SourceInfo;
  name: string;
  /** @1x width; null uses the default from the image. */
  baseWidth: number | null;
}

/** Mirrors `default_base_size` in crates/icon-core/src/imageset.rs. */
function defaultBaseWidth(info: SourceInfo): number {
  return Math.max(1, Math.round(info.kind === "raster" ? info.width / 3 : info.width));
}

function baseSize(item: Item): [number, number] {
  const width = item.baseWidth ?? defaultBaseWidth(item.info);
  return [width, Math.max(1, Math.round((width * item.info.height) / item.info.width))];
}

interface Props {
  preferences: Preferences;
}

/** In-app images at every density: Xcode image sets and Android drawables. */
export function ImageSetWorkspace({ preferences }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = usePersistentState<Settings>(IMAGE_SETS_STORAGE_KEY, DEFAULT_SETTINGS);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const [items, setItems] = useState<Item[]>([]);
  const [addError, setAddError] = useState<unknown>(null);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });

  async function addPaths(paths: string[]) {
    setAddError(null);
    setStatus({ kind: "idle" });
    const results = await Promise.allSettled(paths.map((p) => describeImage(p)));
    const added = results.flatMap((r) =>
      r.status === "fulfilled"
        ? [{ info: r.value, name: r.value.fileName.replace(/\.[^.]+$/, ""), baseWidth: null }]
        : [],
    );
    setItems((current) => [
      ...current,
      ...added.filter((a) => !current.some((c) => c.info.path === a.info.path)),
    ]);
    const failure = results.find((r) => r.status === "rejected");
    if (failure) setAddError(failure.reason);
  }

  const dragging = useFileDrop(addPaths);

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [{ name: t("dialog.imageFilter"), extensions: SUPPORTED_EXTENSIONS }],
    });
    if (picked && picked.length > 0) await addPaths(picked);
  }

  const updateItem = (path: string, patch: Partial<Item>) =>
    setItems((current) => current.map((i) => (i.info.path === path ? { ...i, ...patch } : i)));

  const filesPerImage = (settings.ios ? IOS_FILES : 0) + (settings.android ? ANDROID_FILES : 0);
  const blockedReason =
    items.length === 0
      ? t("imageSets.noImages")
      : !settings.ios && !settings.android
        ? t("imageSets.noTargets")
        : null;

  async function generate() {
    if (blockedReason || status.kind === "running") return;
    const baseName = formatOutputName("{name}-{date}", "ImageSets");
    const choice = await chooseOutputTarget({
      kind: settings.outputKind,
      baseName,
      startDir: preferences.rememberOutputDir ? settings.lastOutputDir : null,
      folderTitle: t("dialog.folderTitle", { name: baseName }),
    });
    if (!choice) return;
    if (preferences.rememberOutputDir) update({ lastOutputDir: choice.dir });

    setStatus({ kind: "running", progress: { done: 0, total: 1 } });
    try {
      const report = await generateImageSets(
        items.map((i) => ({ path: i.info.path, name: i.name, baseWidth: i.baseWidth })),
        { ios: settings.ios, android: settings.android, optimizePng: settings.optimizePng },
        choice.target,
        (progress) => setStatus({ kind: "running", progress }),
      );
      setStatus({ kind: "done", report });
      if (preferences.revealAfterExport) revealItemInDir(report.outputPath);
    } catch (err) {
      setStatus({ kind: "error", error: err });
    }
  }

  useShortcuts({ open: pickFiles, generate });

  return (
    <>
      <div className="app-body">
        <aside className="sidebar">
          <button
            type="button"
            className={`dropzone dropzone-compact ${dragging ? "is-dragging" : ""}`}
            onClick={pickFiles}
          >
            <span className="dropzone-empty">
              <UploadIcon width={28} height={28} />
              <strong>{t("imageSets.drop")}</strong>
              <span className="muted">
                PNG · JPG · WebP · SVG · {modKey}+O
              </span>
            </span>
          </button>
          {addError != null && (
            <div className="warning is-error" role="alert">
              <WarningIcon width={14} height={14} />
              {describeError(addError, t).message}
            </div>
          )}

          <section className="panel">
            <h2>{t("imageSets.targets")}</h2>
            <div className="field">
              <label className="field-row">
                <input
                  type="checkbox"
                  checked={settings.ios}
                  onChange={(e) => update({ ios: e.target.checked })}
                />
                <span>{t("imageSets.ios")}</span>
              </label>
            </div>
            <div className="field">
              <label className="field-row">
                <input
                  type="checkbox"
                  checked={settings.android}
                  onChange={(e) => update({ android: e.target.checked })}
                />
                <span>{t("imageSets.android")}</span>
              </label>
            </div>
            <div className="field">
              <label className="field-row">
                <input
                  type="checkbox"
                  checked={settings.optimizePng}
                  onChange={(e) => update({ optimizePng: e.target.checked })}
                />
                <span>{t("options.optimizePng")}</span>
              </label>
              <p className="help">{t("options.optimizePngHelp")}</p>
            </div>
          </section>
        </aside>

        <main className="content">
          <section className="panel">
            <div className="panel-header">
              <h2>{t("imageSets.list", { count: items.length })}</h2>
              {items.length > 0 && (
                <button type="button" className="link-button" onClick={() => setItems([])}>
                  {t("imageSets.clear")}
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="muted empty-state">{t("imageSets.empty")}</p>
            ) : (
              <>
                <ul className="imageset-list">
                  {items.map((item) => (
                    <ImageSetRow
                      key={item.info.path}
                      item={item}
                      ios={settings.ios}
                      android={settings.android}
                      onChange={(patch) => updateItem(item.info.path, patch)}
                      onRemove={() =>
                        setItems((current) => current.filter((i) => i.info.path !== item.info.path))
                      }
                    />
                  ))}
                </ul>
                <p className="help">{t("imageSets.baseWidthHelp")}</p>
              </>
            )}
          </section>
        </main>
      </div>

      <ExportBar
        outputKind={settings.outputKind}
        onOutputKindChange={(outputKind) => update({ outputKind })}
        fileCount={items.length * filesPerImage}
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

interface RowProps {
  item: Item;
  ios: boolean;
  android: boolean;
  onChange: (patch: Partial<Item>) => void;
  onRemove: () => void;
}

function ImageSetRow({ item, ios, android, onChange, onRemove }: RowProps) {
  const { t } = useI18n();
  const thumbnail = useThumbnail(item.info.path, 96);
  const [w, h] = baseSize(item);
  const size = (scale: number) => `${Math.round(w * scale)}×${Math.round(h * scale)}`;
  const id = item.info.path;

  return (
    <li className="imageset-row">
      <span className="imageset-thumb checkerboard">
        {thumbnail && <img src={thumbnail} alt="" width={48} height={48} />}
      </span>
      <div className="imageset-fields">
        <label className="imageset-field">
          <span className="muted">{t("imageSets.name")}</span>
          <input
            className="text-input"
            value={item.name}
            spellCheck={false}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label className="imageset-field imageset-width" htmlFor={`${id}-width`}>
          <span className="muted">{t("imageSets.baseWidth")}</span>
          <input
            id={`${id}-width`}
            className="text-input"
            type="number"
            min={1}
            max={4096}
            placeholder={String(defaultBaseWidth(item.info))}
            value={item.baseWidth ?? ""}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              onChange({ baseWidth: Number.isFinite(value) && value > 0 ? value : null });
            }}
          />
        </label>
        <div className="imageset-sizes muted" title={item.info.path}>
          {ios && <span>iOS {IOS_SCALES.map((s) => `@${s}x ${size(s)}`).join(" · ")}</span>}
          {android && (
            <span>Android {ANDROID_DENSITIES.map(([d, s]) => `${d} ${size(s)}`).join(" · ")}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={onRemove}
        title={t("imageSets.remove")}
        aria-label={t("imageSets.remove")}
      >
        <CloseIcon width={14} height={14} />
      </button>
    </li>
  );
}
