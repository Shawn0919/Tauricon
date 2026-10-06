import { useI18n } from "../i18n";

interface Props {
  paths: string[];
  currentPath: string | null;
  onOpen: (path: string) => void;
  onClear: () => void;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

export function RecentFiles({ paths, currentPath, onOpen, onClear }: Props) {
  const { t } = useI18n();
  const others = paths.filter((p) => p !== currentPath);
  if (others.length === 0) return null;

  return (
    <section className="recent">
      <div className="panel-header">
        <h2>{t("recent.title")}</h2>
        <button type="button" className="link-button" onClick={onClear}>
          {t("recent.clear")}
        </button>
      </div>
      <ul>
        {others.map((path) => (
          <li key={path}>
            <button type="button" className="recent-item" title={path} onClick={() => onOpen(path)}>
              {fileName(path)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
