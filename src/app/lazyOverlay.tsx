import { lazy, Suspense, useState, type ComponentType } from 'react';
import { reloadOnFailedImport } from './screens';

/**
 * A part that most sessions never open (the task panel on Home, Focus mode, the feedback sheet) loads in its own chunk
 * (performance audit 2026-10-21, FL-1 and FL-4). It keeps the first load small and still opens at once:
 * - `warm()` starts the import early and keeps the loaded component in a module variable.
 * - A part that mounts after `warm()` finished renders the component itself, with no Suspense step. A plain React.lazy adds
 *   about 500 ms to the first press, because React holds back the reveal of a Suspense fallback.
 * - A part that mounts before the chunk is there uses React.lazy for its whole life, so the chunk arriving never remounts it.
 *   Without that rule, a draft in the open panel would reset on the next render.
 * - A failed import at the first use reloads the page once (`reloadOnFailedImport`). A failed warm-up is silent.
 */
export function lazyOverlay<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;

  /** Imports the part once. A failed import leaves no trace, so the next call tries again. */
  function warm(): Promise<ComponentType<P>> {
    if (loaded) return Promise.resolve(loaded);
    loading ??= load().then(
      (component) => {
        loaded = component;
        loading = null;
        return component;
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
    return loading;
  }

  const Late = lazy(() => reloadOnFailedImport(warm).then((component) => ({ default: component })));

  function Overlay(props: P) {
    // The choice is made once, at the mount.
    const [ready] = useState(() => loaded);
    if (ready) {
      const Ready = ready as ComponentType<object>;
      return <Ready {...props} />;
    }
    const WaitFor = Late as unknown as ComponentType<object>;
    return (
      <Suspense fallback={null}>
        <WaitFor {...props} />
      </Suspense>
    );
  }

  return {
    Overlay,
    /** Starts the import. It never throws: a failure shows at the first use. */
    warm: (): void => void warm().catch(() => undefined),
    /** True once the component is in memory (the tests use it). */
    isLoaded: (): boolean => loaded !== null,
  };
}

/**
 * True from the first render in which `on` is true, and true after that. A part that animates out when it closes stays mounted
 * after its first use, so its exit animation stays.
 */
export function useOnceOn(on: boolean): boolean {
  const [seen, setSeen] = useState(on);
  if (on && !seen) setSeen(true);
  return on || seen;
}
