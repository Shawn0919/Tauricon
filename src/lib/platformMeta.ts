// Frontend-only presentation details for the platform ids defined in
// crates/icon-core/presets. Unknown ids still render, just without extras.
import { isMessageKey, type MessageKey } from "../i18n";

export type PreviewShape = "ios" | "circle" | "squircle" | "square";

export interface PreviewTile {
  label: MessageKey;
  shape: PreviewShape;
  /** The platform always fills transparency (white when no color is chosen). */
  opaque?: boolean;
  note?: MessageKey;
}

export const PREVIEW_TILES: Record<string, PreviewTile[]> = {
  ios: [{ label: "preview.tile.ios", shape: "ios", opaque: true }],
  watchos: [{ label: "preview.tile.watchos", shape: "circle", opaque: true }],
  macos: [{ label: "preview.tile.macos", shape: "square", note: "preview.note.noMask" }],
  android: [
    { label: "preview.tile.androidRound", shape: "circle" },
    { label: "preview.tile.androidSquircle", shape: "squircle" },
  ],
  windows: [{ label: "preview.tile.windows", shape: "square" }],
};

/** Description key for a platform card, if the locale files define one. */
export function platformDescriptionKey(id: string): MessageKey | null {
  const key = `platform.${id}.description`;
  return isMessageKey(key) ? key : null;
}
