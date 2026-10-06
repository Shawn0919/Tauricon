import { useI18n } from "../i18n";

interface Props {
  optimizePng: boolean;
  onOptimizePngChange: (optimize: boolean) => void;
}

export function OutputOptions({ optimizePng, onOptimizePngChange }: Props) {
  const { t } = useI18n();

  return (
    <section className="panel">
      <h2>{t("options.title")}</h2>
      <div className="field">
        <label className="field-row">
          <input
            type="checkbox"
            checked={optimizePng}
            onChange={(e) => onOptimizePngChange(e.target.checked)}
          />
          <span>{t("options.optimizePng")}</span>
        </label>
        <p className="help">{t("options.optimizePngHelp")}</p>
      </div>
    </section>
  );
}
