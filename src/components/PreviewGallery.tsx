import { useI18n } from "../i18n";
import { PREVIEW_TILES, type PreviewSource, type PreviewTile } from "../lib/platformMeta";

interface Props {
  /** Rendered preview URLs; a source is null when not rendered (yet). */
  previews: Record<PreviewSource, string | null>;
  platformIds: string[];
}

const SMALL_SIZES = [16, 24, 32, 48];

export function PreviewGallery({ previews, platformIds }: Props) {
  const { t } = useI18n();
  const tiles: PreviewTile[] = platformIds.flatMap((id) => PREVIEW_TILES[id] ?? []);
  const showFavicon = platformIds.includes("web");
  const previewUrl = previews.base;
  // Small sizes matter most for Windows/Web, which show the user's shape.
  const smallUrl = previews.custom ?? previews.base;

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
                  src={previews[tile.source] ?? previewUrl}
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
                <img src={smallUrl ?? undefined} width={px} height={px} alt={`${px} px`} />
                <figcaption>{px}</figcaption>
              </figure>
            ))}
            {showFavicon && (
              <div className="browser-tab" aria-label={t("preview.browserTab")}>
                <img src={smallUrl ?? undefined} width={16} height={16} alt="" />
                <span>{t("preview.siteName")}</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
