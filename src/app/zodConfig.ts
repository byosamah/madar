/**
 * zod runs jitless in the browser. Without it, zod tests once whether eval works (new Function), and the deployed page, with
 * script-src 'self' (config/headers.template), reports a Content-Security-Policy violation on every load, although zod
 * catches the error. Never add 'unsafe-eval' to the policy instead. main.tsx imports this file first, before any parse.
 * The core setting of zod (z.config) is one object on globalThis, and every zod schema reads it. This file changes that object
 * in place and imports nothing from zod, so the first load holds no zod code at all (performance audit BND-6, 2026-10-21 FL-10:
 * the import of `config` kept 3.9 KB gz of zod core utilities in the first script). In place, never a new object: a zod core
 * that loaded earlier holds the old object. zodConfig.core.test.ts fails when a zod upgrade renames the key.
 */
const holder = globalThis as { __zod_globalConfig?: Record<string, unknown> };
const setting = (holder.__zod_globalConfig ??= {});
setting.jitless = true;

export {};
