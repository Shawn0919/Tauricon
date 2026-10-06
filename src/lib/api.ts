// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
import { Channel, invoke } from "@tauri-apps/api/core";

export interface PlatformInfo {
  id: string;
  name: string;
  /** Base platform id when this is an alternative output of it (e.g. ios-single → ios). */
  variantOf: string | null;
  fileCount: number;
}

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

export interface GenerateOptions {
  platforms: string[];
  background: Color | null;
  /** Fraction of the icon size on each side, 0–0.4. */
  padding: number;
  /** Losslessly recompress PNG files. */
  optimizePng: boolean;
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

/** Resolves to an object URL for a PNG; revoke it with URL.revokeObjectURL when replaced. */
export async function renderPreview(
  size: number,
  background: Color | null,
  padding: number,
): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("render_preview", { size, background, padding });
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
