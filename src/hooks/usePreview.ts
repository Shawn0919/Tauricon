import { useEffect, useRef, useState } from "react";
import { renderPreview, type SourceInfo } from "../lib/api";
import { hexToColor } from "../lib/color";

const PREVIEW_PX = 512;

/**
 * Object URL of the composed icon, re-rendered by Rust whenever the source or
 * settings change. Stale responses are dropped so fast slider drags can't
 * show an older result last.
 */
export function usePreview(source: SourceInfo | null, backgroundHex: string | null, padding: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);
  const current = useRef<string | null>(null);

  useEffect(() => {
    if (!source) return;
    const request = ++latest.current;
    const background = backgroundHex ? hexToColor(backgroundHex) : null;

    renderPreview(PREVIEW_PX, background, padding)
      .then((next) => {
        if (request !== latest.current) {
          URL.revokeObjectURL(next);
          return;
        }
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
        setError(null);
      })
      .catch((err) => {
        if (request === latest.current) setError(err);
      });
  }, [source, backgroundHex, padding]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  return { url: source ? url : null, error };
}
