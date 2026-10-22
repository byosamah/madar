import { z } from 'zod';
import { config } from 'zod/v4/core';
import { describe, expect, it, vi } from 'vitest';

describe('the zod setting of the browser', () => {
  it('turns on jitless through the core setting, which z.config shares (performance audit BND-6)', async () => {
    // The core setting is the function of z.config, and its object lives on globalThis, so every zod schema reads it.
    expect(config).toBe(z.config);
    await import('./zodConfig');
    expect(z.config().jitless).toBe(true);
    expect((globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless).toBe(true);
  });

  it('imports nothing from zod, so the first load holds no zod core code (performance audit 2026-10-21, FL-10)', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync('src/app/zodConfig.ts', 'utf8');
    expect(text.match(/^import .*$/gm)).toBeNull();
    expect(text).not.toMatch(/from ['"]zod/);
  });

  it('changes the object that zod holds in place, so a zod core that loaded earlier sees the setting', async () => {
    // The key of the core setting is the guard of the first test: when zod renames it, that test fails first.
    const holder = globalThis as { __zod_globalConfig?: Record<string, unknown> };
    const before = holder.__zod_globalConfig!;
    expect(before).toBeDefined();
    delete before.jitless;
    vi.resetModules();
    await import('./zodConfig');
    expect(holder.__zod_globalConfig).toBe(before);
    expect(before.jitless).toBe(true);
  });
});
