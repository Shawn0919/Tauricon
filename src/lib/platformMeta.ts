// Frontend-only presentation details for the platform ids defined in
// crates/icon-core/presets. Unknown ids still render, just without extras.
import { isMessageKey, type MessageKey } from "../i18n";

export type PreviewShape = "ios" | "circle" | "squircle" | "square";

/**
 * Which rendered preview a tile shows: "base" is the full-bleed square (the
 * OS masks it, so CSS applies the shape); the others are already shaped by
 * Rust with the user's corner radius / macOS template.
 */
export type PreviewSource = "base" | "macos" | "custom";

export interface PreviewTile {
  label: MessageKey;
  shape: PreviewShape;
  source: PreviewSource;
  /** The platform always fills transparency (white when no color is chosen). */
  opaque?: boolean;
  note?: MessageKey;
}

export const PREVIEW_TILES: Record<string, PreviewTile[]> = {
  ios: [{ label: "preview.tile.ios", shape: "ios", source: "base", opaque: true }],
  watchos: [{ label: "preview.tile.watchos", shape: "circle", source: "base", opaque: true }],
  macos: [
    { label: "preview.tile.macos", shape: "square", source: "macos", note: "preview.note.noMask" },
  ],
  android: [
    { label: "preview.tile.androidRound", shape: "circle", source: "base" },
    { label: "preview.tile.androidSquircle", shape: "squircle", source: "base" },
  ],
  windows: [{ label: "preview.tile.windows", shape: "square", source: "custom" }],
};

/** Description key for a platform card, if the locale files define one. */
export function platformDescriptionKey(id: string): MessageKey | null {
  const key = `platform.${id}.description`;
  return isMessageKey(key) ? key : null;
}
