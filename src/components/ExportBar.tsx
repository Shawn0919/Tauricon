import { useI18n } from "../i18n";
import type { GenerateReport, OutputTarget, Progress } from "../lib/api";
import { describeError } from "../lib/errors";
import { modKey, revealLabelKey } from "../lib/platform";
import { CheckIcon, CloseIcon, FolderIcon, WarningIcon, ZipIcon } from "./Icons";

export type ExportStatus =
  | { kind: "idle" }
  | { kind: "running"; progress: Progress }
  | { kind: "done"; report: GenerateReport }
  | { kind: "error"; error: unknown };

interface Props {
  outputKind: OutputTarget["kind"];
  onOutputKindChange: (kind: OutputTarget["kind"]) => void;
  fileCount: number;
  /** Why generating is unavailable, or null when ready. */
  blockedReason: string | null;
  status: ExportStatus;
  onGenerate: () => void;
  onReveal: (path: string) => void;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExportBar(props: Props) {
  const { t } = useI18n();
  const { outputKind, fileCount, blockedReason, status } = props;
  const running = status.kind === "running";

  return (
    <footer className="export-bar">
      <div className="segmented" role="radiogroup" aria-label={t("export.kindLabel")}>
        <button
          type="button"
          role="radio"
          aria-checked={outputKind === "zip"}
          className={outputKind === "zip" ? "is-active" : ""}
          onClick={() => props.onOutputKindChange("zip")}
          disabled={running}
        >
          <ZipIcon width={16} height={16} /> {t("export.zip")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={outputKind === "folder"}
          className={outputKind === "folder" ? "is-active" : ""}
          onClick={() => props.onOutputKindChange("folder")}
          disabled={running}
        >
          <FolderIcon width={16} height={16} /> {t("export.folder")}
        </button>
      </div>

      <div className="export-status" aria-live="polite">
        {status.kind === "running" && (
          <progress value={status.progress.done} max={status.progress.total} />
        )}
        {status.kind === "done" && (
          <span className="status-success">
            <CheckIcon width={16} height={16} />
            {t("export.done", {
              count: status.report.fileCount,
              size: formatBytes(status.report.totalBytes),
              ms: status.report.elapsedMs,
            })}
            <button
              type="button"
              className="link-button"
              onClick={() => props.onReveal(status.report.outputPath)}
            >
              {t(revealLabelKey)}
            </button>
          </span>
        )}
        {status.kind === "error" && (
          <span className="status-error" title={describeError(status.error, t).detail}>
            <WarningIcon width={16} height={16} />
            {describeError(status.error, t).message}
            <button
              type="button"
              className="icon-button"
              onClick={props.onDismiss}
              aria-label={t("export.dismiss")}
            >
              <CloseIcon width={14} height={14} />
            </button>
          </span>
        )}
        {status.kind === "idle" && blockedReason && <span className="muted">{blockedReason}</span>}
      </div>

      <button
        type="button"
        className="primary-button"
        disabled={!!blockedReason || running}
        onClick={props.onGenerate}
        title={`${modKey}+Enter`}
      >
        {running ? t("export.running") : t("export.generate", { count: fileCount })}
      </button>
    </footer>
  );
}
