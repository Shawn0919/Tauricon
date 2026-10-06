import { useEffect, useRef, useState } from "react";
import { renderPreview, type PreviewTarget, type SourceInfo, type StyleOptions } from "../lib/api";

const PREVIEW_PX = 512;

/**
 * Object URL of `target` rendered by Rust. Re-renders when the source, style
 * or `revision` (bump it when layer images change) changes; stale responses
 * are dropped so fast slider drags can't show an older result last.
 * Pass `enabled: false` to skip rendering previews nobody will see.
 */
export function usePreview(
  source: SourceInfo | null,
  style: StyleOptions,
  target: PreviewTarget,
  { enabled = true, revision = 0 }: { enabled?: boolean; revision?: number } = {},
) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);
  const current = useRef<string | null>(null);
  // Objects are rebuilt every render; compare by value.
  const styleKey = JSON.stringify(style);
  const targetKey = JSON.stringify(target);

  useEffect(() => {
    if (!source || !enabled) return;
    const request = ++latest.current;

    renderPreview(PREVIEW_PX, JSON.parse(styleKey) as StyleOptions, JSON.parse(targetKey) as PreviewTarget)
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
  }, [source, styleKey, targetKey, enabled, revision]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  return { url: source && enabled ? url : null, error };
}
