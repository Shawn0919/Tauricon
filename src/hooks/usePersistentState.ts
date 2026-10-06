import { useEffect, useState } from "react";

/**
 * useState that survives restarts via localStorage. Storage failures are
 * ignored: the app works the same, it just forgets settings.
 */
export function usePersistentState<T extends object>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      // Merge so settings added in later versions get their defaults.
      if (stored) return { ...initial, ...JSON.parse(stored) } as T;
    } catch {
      // fall through to the default
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);

  return [value, setValue] as const;
}
