import type { MessageKey, Translate } from "../i18n";
import { isCommandError } from "./api";

const KNOWN_CODES = new Set([
  "io",
  "unsupportedFormat",
  "decode",
  "svg",
  "inputTooLarge",
  "dimensionsTooLarge",
  "emptyImage",
  "unknownPlatform",
  "platformConflict",
  "unsafePath",
  "encode",
  "zip",
  "noSource",
  "noPlatforms",
]);

/** User-facing message, with the technical detail kept for troubleshooting. */
export function describeError(err: unknown, t: Translate): { message: string; detail?: string } {
  if (isCommandError(err)) {
    const key = KNOWN_CODES.has(err.code) ? (`error.${err.code}` as MessageKey) : "error.unexpected";
    return { message: t(key), detail: err.message };
  }
  return { message: t("error.unexpected"), detail: String(err) };
}
