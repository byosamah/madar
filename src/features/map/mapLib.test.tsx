import { render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Performance audit 2026-10-21, FL-17 and LV-10. The map library starts with the MapCanvas chunk (not after it), and a press on
// the Map tab starts both. No map and no tile is made by either.
vi.hoisted(() => { vi.stubEnv('VITE_MADAR_API', 'remote'); });
const lib = vi.hoisted(() => ({
  setWorkerUrl: undefined as unknown as ReturnType<typeof vi.fn>,
  setRTLTextPlugin: undefined as unknown as ReturnType<typeof vi.fn>,
  addProtocol: undefined as unknown as ReturnType<typeof vi.fn>,
  made: 0,
  canvasLoaded: 0,
}));

vi.mock('maplibre-gl', () => {
  lib.setWorkerUrl = vi.fn();
  lib.setRTLTextPlugin = vi.fn(() => Promise.resolve());
  lib.addProtocol = vi.fn();
  return {
    Map: class {
      constructor() {
        lib.made += 1;
      }
    },
    setWorkerUrl: lib.setWorkerUrl,
    setRTLTextPlugin: lib.setRTLTextPlugin,
    addProtocol: lib.addProtocol,
  };
});
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker.js' }));
vi.mock('../../../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url', () => ({ default: '/assets/rtl-text-abc.js' }));
// The canvas itself is a double that never calls the loader: only the lazy factory can start the library.
vi.mock('./MapCanvas', () => {
  lib.canvasLoaded += 1;
  return { default: () => <div role="region" aria-label="Map double" /> };
});

beforeEach(() => {
  vi.resetModules();
  lib.made = 0;
  lib.setWorkerUrl?.mockClear();
});

describe('the map loader', () => {
  it('starts the library with the MapCanvas chunk, before the canvas runs any code of its own', async () => {
    const { lazyMapCanvas } = await import('./mapLib');
    const Canvas = lazyMapCanvas();
    render(<Suspense fallback={null}><Canvas pins={[]} /></Suspense>);
    expect(await screen.findByRole('region', { name: 'Map double' })).toBeInTheDocument();
    await waitFor(() => expect(lib.setWorkerUrl).toHaveBeenCalledTimes(1));
    expect(lib.made).toBe(0);
  });

  it('warms the chunk and the library on a press of the Map tab, and makes no map', async () => {
    lib.canvasLoaded = 0;
    vi.doMock('./MapCanvas', () => {
      lib.canvasLoaded += 1;
      return { default: () => null };
    });
    const { warmMap } = await import('./mapLib');
    warmMap();
    await waitFor(() => expect(lib.setWorkerUrl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(lib.canvasLoaded).toBe(1));
    warmMap();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lib.setWorkerUrl).toHaveBeenCalledTimes(1);
    expect(lib.made).toBe(0);
    expect(lib.canvasLoaded).toBe(1);
  });

  it('loads the library again after a failed load, so a press that failed on a weak network does not stick', async () => {
    const { loadMapLib } = await import('./mapLib');
    lib.setWorkerUrl.mockImplementationOnce(() => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    await expect(loadMapLib()).rejects.toThrow('Failed to fetch');
    await expect(loadMapLib()).resolves.toBeDefined();
    expect(lib.setWorkerUrl).toHaveBeenCalledTimes(2);
  });

  it('loads nothing in a build without the real-build flag, so the prototype carries no map file', async () => {
    vi.stubEnv('VITE_MADAR_API', '');
    try {
      const { loadMapLib } = await import('./mapLib');
      await expect(loadMapLib()).rejects.toThrow('real build only');
      expect(lib.setWorkerUrl).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('VITE_MADAR_API', 'remote');
    }
  });

  it('adds the release to the worker address', async () => {
    const { releaseUrl } = await import('./mapLib');
    expect(releaseUrl('/assets/w.js', '2026.10.19')).toBe('/assets/w.js?release=2026.10.19');
    expect(releaseUrl('/assets/w.js', undefined)).toBe('/assets/w.js?release=0');
  });
});
