import { useCallback, useState } from 'react';

/** A per-viewer choice that lasts to the next visit, such as grid or list. Blocked storage makes it last for this visit only. */
export function usePersistentChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return allowed.includes(stored as T) ? (stored as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = useCallback((next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Storage is blocked. The choice lasts for this visit only.
    }
  }, [key]);
  return [value, choose];
}
