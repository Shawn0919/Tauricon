// Output names built from a user template such as "{name}-icons".

export const DEFAULT_NAME_TEMPLATE = "{name}-icons";

const pad = (n: number) => String(n).padStart(2, "0");

/** Characters Windows and macOS reject in file names, plus control characters. */
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Expands {name} (source file name without extension), {date} (YYYYMMDD) and
 * {time} (HHmmss), then makes the result safe to use as a file or folder name.
 */
export function formatOutputName(template: string, sourceFileName: string, now = new Date()): string {
  const name = sourceFileName.replace(/\.[^.]+$/, "") || "AppIcon";
  const values: Record<string, string> = {
    name,
    date: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
  const expanded = (template.trim() || DEFAULT_NAME_TEMPLATE).replace(
    /\{(\w+)\}/g,
    (match, key: string) => values[key] ?? match,
  );
  // Trailing dots and spaces are invalid on Windows.
  const safe = expanded.replace(INVALID_CHARS, "-").replace(/[. ]+$/, "").trim();
  return safe || `${name}-icons`;
}
