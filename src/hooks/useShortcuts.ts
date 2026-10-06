import { useEffect, useRef } from "react";
import { hasModKey } from "../lib/platform";

interface Handlers {
  /** Ctrl/⌘+O */
  open: () => void;
  /** Ctrl/⌘+Enter */
  generate: () => void;
}

/** App-wide shortcuts; reads the latest handlers so callers needn't memoize. */
export function useShortcuts(handlers: Handlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!hasModKey(event)) return;
      // Leave shortcuts alone while a modal (e.g. Settings) is open.
      if (document.querySelector("dialog[open]")) return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        latest.current.open();
      } else if (event.key === "Enter") {
        event.preventDefault();
        latest.current.generate();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
