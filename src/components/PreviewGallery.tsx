import { useI18n } from "../i18n";
import { PREVIEW_TILES, type PreviewTile } from "../lib/platformMeta";

interface Props {
  previewUrl: string | null;
  platformIds: string[];
}

const SMALL_SIZES = [16, 24, 32, 48];

export function PreviewGallery({ previewUrl, platformIds }: Props) {
  const { t } = useI18n();
  const tiles: PreviewTile[] = platformIds.flatMap((id) => PREVIEW_TILES[id] ?? []);
  const showFavicon = platformIds.includes("web");

  return (
    <section className="panel">
      <h2>{t("preview.title")}</h2>
      {!previewUrl ? (
        <p className="muted empty-state">{t("preview.empty")}</p>
      ) : (
        <>
          <div className="tiles">
            {tiles.map((tile) => (
              <figure key={tile.label} className="tile">
                <img
                  className={`tile-image shape-${tile.shape} ${tile.opaque ? "opaque" : "checkerboard"}`}
                  src={previewUrl}
                  alt={t(tile.label)}
                />
                <figcaption>
                  {t(tile.label)}
                  {tile.note && <span className="muted">{t(tile.note)}</span>}
                </figcaption>
              </figure>
            ))}
          </div>

          <div className="small-sizes">
            <span className="muted">{t("preview.smallSizes")}</span>
            {SMALL_SIZES.map((px) => (
              <figure key={px} className="small-size">
                <img src={previewUrl} width={px} height={px} alt={`${px} px`} />
                <figcaption>{px}</figcaption>
              </figure>
            ))}
            {showFavicon && (
              <div className="browser-tab" aria-label={t("preview.browserTab")}>
                <img src={previewUrl} width={16} height={16} alt="" />
                <span>{t("preview.siteName")}</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
