'use client';
import { useCallback, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** useState that survives reloads. For per-device preferences only, never note data. */
export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = next instanceof Function ? next(prev) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Storage can be unavailable (private mode, quota); the in-memory value still works.
      }
      return resolved;
    });
  }, [key]);

  return [value, update] as const;
}
