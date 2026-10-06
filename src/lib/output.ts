import { join, dirname } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { OutputTarget } from "./api";

interface Request {
  kind: OutputTarget["kind"];
  /** ZIP file name (without .zip) or the folder created inside the chosen one. */
  baseName: string;
  /** Folder the dialog starts in, if any. */
  startDir: string | null;
  /** Title for the folder picker. */
  folderTitle: string;
}

/**
 * Asks where to save. Returns the target plus the folder to remember for
 * next time, or null if the user cancelled.
 */
export async function chooseOutputTarget(
  request: Request,
): Promise<{ target: OutputTarget; dir: string } | null> {
  const { kind, baseName, startDir, folderTitle } = request;

  if (kind === "zip") {
    const fileName = `${baseName}.zip`;
    const path = await save({
      defaultPath: startDir ? await join(startDir, fileName) : fileName,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    return path ? { target: { kind: "zip", path }, dir: await dirname(path) } : null;
  }

  const dir = await open({ directory: true, defaultPath: startDir ?? undefined, title: folderTitle });
  if (!dir) return null;
  // Write into a subfolder so outputs don't scatter over e.g. the Desktop.
  return { target: { kind: "folder", path: await join(dir, baseName) }, dir };
}
