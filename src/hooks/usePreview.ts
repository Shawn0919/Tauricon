import { useEffect, useRef, useState } from "react";
import { renderPreview, type SourceInfo, type StyleOptions } from "../lib/api";

const PREVIEW_PX = 512;

/**
 * Object URL of the icon rendered by Rust, styled like `platform`'s main icon
 * (or full-bleed when null). Re-renders when the source or style changes;
 * stale responses are dropped so fast slider drags can't show an older result
 * last. Pass `enabled: false` to skip rendering previews nobody will see.
 */
export function usePreview(
  source: SourceInfo | null,
  style: StyleOptions,
  platform: string | null,
  enabled = true,
) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);
  const current = useRef<string | null>(null);
  // Style objects are rebuilt every render; compare by value.
  const styleKey = JSON.stringify(style);

  useEffect(() => {
    if (!source || !enabled) return;
    const request = ++latest.current;

    renderPreview(PREVIEW_PX, JSON.parse(styleKey) as StyleOptions, platform)
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
  }, [source, styleKey, platform, enabled]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  return { url: source && enabled ? url : null, error };
}
