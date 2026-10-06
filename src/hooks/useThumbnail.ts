import { useEffect, useState } from "react";
import { renderThumbnail } from "../lib/api";

/** Object URL of a Rust-rendered thumbnail for an image file. */
export function useThumbnail(path: string, size = 96): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    renderThumbnail(path, size)
      .then((next) => {
        if (cancelled) {
          URL.revokeObjectURL(next);
        } else {
          created = next;
          setUrl(next);
        }
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, size]);

  return url;
}
