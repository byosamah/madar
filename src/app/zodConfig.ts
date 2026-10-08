import { config } from 'zod/v4/core';

/**
 * zod runs jitless in the browser. Without it, zod tests once whether eval works (new Function), and the deployed page, with
 * script-src 'self' (config/headers.template), reports a Content-Security-Policy violation on every load, although zod
 * catches the error. Never add 'unsafe-eval' to the policy instead. main.tsx imports this file first, before any parse.
 * The core setting is the function of z.config, and its object lives on globalThis, so every zod schema reads it. This file
 * imports only that setting, so the first load holds no zod schemas (performance audit BND-6).
 */
config({ jitless: true });
