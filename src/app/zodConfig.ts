import { z } from 'zod';

/**
 * zod runs jitless in the browser. Without it, zod tests once whether eval works (new Function), and the deployed page, with
 * script-src 'self' (config/headers.template), reports a Content-Security-Policy violation on every load, although zod
 * catches the error. Never add 'unsafe-eval' to the policy instead. main.tsx imports this file first, before any parse.
 */
z.config({ jitless: true });
