import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/**
 * Applies the theme to the page (via `data-theme` on <html>, read by App.css)
 * and to the native window chrome, and returns the theme actually shown.
 */
export function useTheme(preference: ThemePreference): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(darkQuery.matches);

  useEffect(() => {
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = preference;
    }
    // Title bar follows too; null hands control back to the OS.
    getCurrentWindow()
      .setTheme(preference === "system" ? null : preference)
      .catch(() => {});
  }, [preference]);

  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}
