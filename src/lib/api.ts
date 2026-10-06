// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
import { Channel, invoke } from "@tauri-apps/api/core";

export interface PlatformInfo {
  id: string;
  name: string;
  /** Base platform id when this is an alternative output of it (e.g. ios-single → ios). */
  variantOf: string | null;
  fileCount: number;
  /** Files only output depending on options (see crates/icon-core spec `tag`/`when`). */
  optionalFiles: OptionalFile[];
}

export type Condition = "background_image" | "background_color" | "monochrome";

export interface OptionalFile {
  tag: string | null;
  when: Condition | null;
}

/** Android adaptive icon layers that can use their own image. */
export type Layer = "foreground" | "background" | "monochrome";

export type PreviewTarget =
  | { kind: "plain" }
  | { kind: "platform"; id: string }
  | { kind: "androidAdaptive" }
  | { kind: "androidMonochrome" };

export type SourceKind = "raster" | "vector";
export type SourceWarning = "notSquare" | "lowResolution";

export interface SourceInfo {
  path: string;
  fileName: string;
  kind: SourceKind;
  width: number;
  height: number;
  warnings: SourceWarning[];
}

export interface Color {
  r: number;
  g: number;
  b: number;
}

export type Background =
  | { type: "solid"; color: Color }
  /** CSS-style angle in degrees: 0 = bottom→top, 90 = left→right, 180 = top→bottom. */
  | { type: "linearGradient"; from: Color; to: Color; angle: number };

/** Visual options shared by previews and generation. */
export interface StyleOptions {
  background: Background | null;
  /** Fraction of the icon body on each side, 0–0.4. */
  padding: number;
  /** Corner radius for macOS/Windows/Web, fraction of the icon size, 0–0.5. */
  cornerRadius: number;
  /** Apple's macOS template: inset body, rounded corners, shadow. */
  macosTemplate: boolean;
  /** Overrides for spec scale options, e.g. { android_foreground_scale: 0.7 }. */
  scales: Record<string, number>;
}

export interface GenerateOptions extends StyleOptions {
  platforms: string[];
  /** Losslessly recompress PNG files. */
  optimizePng: boolean;
  /** Skip spec files with these tags. */
  disabledTags: string[];
  /** Also output Android 13+ themed (monochrome) icon layers. */
  monochrome: boolean;
}

export type OutputTarget = { kind: "zip"; path: string } | { kind: "folder"; path: string };

export interface Progress {
  done: number;
  total: number;
}

export interface GenerateReport {
  fileCount: number;
  totalBytes: number;
  outputPath: string;
  elapsedMs: number;
}

/** Shape of every rejected command promise. */
export interface CommandError {
  code: string;
  message: string;
}

export function isCommandError(value: unknown): value is CommandError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

export const SUPPORTED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg", "svgz"];

export function listPlatforms(): Promise<PlatformInfo[]> {
  return invoke("list_platforms");
}

export function loadSource(path: string): Promise<SourceInfo> {
  return invoke("load_source", { path });
}

export function loadLayer(layer: Layer, path: string): Promise<SourceInfo> {
  return invoke("load_layer", { layer, path });
}

export function clearLayer(layer: Layer): Promise<void> {
  return invoke("clear_layer", { layer });
}

/**
 * Renders a preview of `target` with the given style.
 * Resolves to an object URL for a PNG; revoke it with URL.revokeObjectURL.
 */
export async function renderPreview(
  size: number,
  style: StyleOptions,
  target: PreviewTarget,
): Promise<string> {
  const options = { ...style, platforms: [] };
  const bytes = await invoke<ArrayBuffer>("render_preview", { size, options, target });
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

export function generateIcons(
  options: GenerateOptions,
  target: OutputTarget,
  onProgress: (progress: Progress) => void,
): Promise<GenerateReport> {
  const channel = new Channel<Progress>();
  channel.onmessage = onProgress;
  return invoke("generate_icons", { options, target, onProgress: channel });
}
