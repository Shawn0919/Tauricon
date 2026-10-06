import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Native file drag-and-drop over the whole window. Uses Tauri's event so we
 * get real file paths instead of reading file contents in JS.
 */
export function useFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      switch (payload.type) {
        case "enter":
        case "over":
          setDragging(true);
          break;
        case "leave":
          setDragging(false);
          break;
        case "drop":
          setDragging(false);
          if (payload.paths.length > 0) handler.current(payload.paths);
          break;
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return dragging;
}
