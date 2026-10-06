import { useI18n } from "../i18n";

interface Props {
  fillBackground: boolean;
  backgroundHex: string;
  padding: number;
  optimizePng: boolean;
  onFillChange: (fill: boolean) => void;
  onOptimizePngChange: (optimize: boolean) => void;
  onBackgroundChange: (hex: string) => void;
  onPaddingChange: (padding: number) => void;
}

export function OutputOptions(props: Props) {
  const { t } = useI18n();
  const { fillBackground, backgroundHex, padding } = props;

  return (
    <section className="panel">
      <h2>{t("options.title")}</h2>

      <div className="field">
        <label className="field-row">
          <input
            type="checkbox"
            checked={fillBackground}
            onChange={(e) => props.onFillChange(e.target.checked)}
          />
          <span>{t("options.fill")}</span>
          <input
            type="color"
            className="color-input"
            value={backgroundHex}
            disabled={!fillBackground}
            onChange={(e) => props.onBackgroundChange(e.target.value.toUpperCase())}
            aria-label={t("options.backgroundColor")}
          />
          <code className="muted">{backgroundHex}</code>
        </label>
        <p className="help">{t("options.fillHelp")}</p>
      </div>

      <div className="field">
        <label className="field-row">
          <input
            type="checkbox"
            checked={props.optimizePng}
            onChange={(e) => props.onOptimizePngChange(e.target.checked)}
          />
          <span>{t("options.optimizePng")}</span>
        </label>
        <p className="help">{t("options.optimizePngHelp")}</p>
      </div>

      <div className="field">
        <label className="field-row" htmlFor="padding">
          <span>{t("options.padding")}</span>
          <span className="field-value">{Math.round(padding * 100)}%</span>
        </label>
        <input
          id="padding"
          type="range"
          min={0}
          max={0.4}
          step={0.01}
          value={padding}
          onChange={(e) => props.onPaddingChange(Number(e.target.value))}
        />
      </div>
    </section>
  );
}
