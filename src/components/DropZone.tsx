import { useI18n } from "../i18n";
import type { SourceInfo } from "../lib/api";
import { modKey } from "../lib/platform";
import { UploadIcon, WarningIcon } from "./Icons";

interface Props {
  source: SourceInfo | null;
  previewUrl: string | null;
  dragging: boolean;
  loading: boolean;
  onPick: () => void;
}

const WARNING_KEYS = {
  notSquare: "source.warning.notSquare",
  lowResolution: "source.warning.lowResolution",
} as const;

export function DropZone({ source, previewUrl, dragging, loading, onPick }: Props) {
  const { t } = useI18n();
  const className = ["dropzone", dragging && "is-dragging", source && "has-source"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="source-panel">
      <button type="button" className={className} onClick={onPick} disabled={loading}>
        {source && previewUrl ? (
          <>
            <img className="dropzone-image checkerboard" src={previewUrl} alt={t("dropzone.previewAlt")} />
            <span className="dropzone-replace">{t("dropzone.replace")}</span>
          </>
        ) : (
          <span className="dropzone-empty">
            <UploadIcon width={32} height={32} />
            <strong>{loading ? t("dropzone.loading") : t("dropzone.title")}</strong>
            <span>{t("dropzone.pick", { shortcut: `${modKey}+O` })}</span>
            <span className="muted">{t("dropzone.formats")}</span>
          </span>
        )}
      </button>

      {source && (
        <div className="source-info">
          <div className="source-name" title={source.path}>
            {source.fileName}
          </div>
          <div className="muted">
            {source.kind === "vector" ? t("source.vector") : t("source.raster")} ·{" "}
            {Math.round(source.width)} × {Math.round(source.height)}
          </div>
          {source.warnings.map((w) => (
            <div key={w} className="warning">
              <WarningIcon width={14} height={14} />
              {t(WARNING_KEYS[w])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
