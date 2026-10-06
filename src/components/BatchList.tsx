import { useI18n } from "../i18n";
import type { SourceInfo } from "../lib/api";
import { useThumbnail } from "../hooks/useThumbnail";
import { CloseIcon } from "./Icons";

interface Props {
  items: SourceInfo[];
  /** Path of the image currently shown in the preview. */
  previewPath: string | null;
  onPreview: (item: SourceInfo) => void;
  onRemove: (item: SourceInfo) => void;
  onClear: () => void;
}

export function BatchList({ items, previewPath, onPreview, onRemove, onClear }: Props) {
  const { t } = useI18n();

  return (
    <section className="panel batch">
      <div className="panel-header">
        <h2>{t("batch.title", { count: items.length })}</h2>
        <button type="button" className="link-button" onClick={onClear}>
          {t("batch.clear")}
        </button>
      </div>
      <ul className="batch-list">
        {items.map((item) => (
          <BatchRow
            key={item.path}
            item={item}
            active={item.path === previewPath}
            onPreview={() => onPreview(item)}
            onRemove={() => onRemove(item)}
          />
        ))}
      </ul>
      <p className="help">{t("batch.note")}</p>
    </section>
  );
}

interface RowProps {
  item: SourceInfo;
  active: boolean;
  onPreview: () => void;
  onRemove: () => void;
}

function BatchRow({ item, active, onPreview, onRemove }: RowProps) {
  const { t } = useI18n();
  const thumbnail = useThumbnail(item.path, 64);

  return (
    <li className={`batch-row ${active ? "is-active" : ""}`}>
      <button type="button" className="batch-item" title={item.path} onClick={onPreview}>
        <span className="batch-thumb checkerboard">
          {thumbnail && <img src={thumbnail} alt="" width={32} height={32} />}
        </span>
        <span className="batch-name">{item.fileName}</span>
        {active && <span className="badge">{t("batch.previewing")}</span>}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onRemove}
        title={t("batch.remove")}
        aria-label={t("batch.remove")}
      >
        <CloseIcon width={14} height={14} />
      </button>
    </li>
  );
}
