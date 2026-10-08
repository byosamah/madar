import { z } from 'zod';
import { config } from 'zod/v4/core';
import { describe, expect, it } from 'vitest';

describe('the zod setting of the browser', () => {
  it('turns on jitless through the core setting, which z.config shares (performance audit BND-6)', async () => {
    // The core setting is the function of z.config, and its object lives on globalThis, so every zod schema reads it.
    expect(config).toBe(z.config);
    await import('./zodConfig');
    expect(z.config().jitless).toBe(true);
    expect((globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless).toBe(true);
  });

  it('imports only the core setting of zod, so the first load holds no zod schemas', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync('src/app/zodConfig.ts', 'utf8');
    expect(text.match(/^import .*$/gm)).toEqual(["import { config } from 'zod/v4/core';"]);
  });
});
