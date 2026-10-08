import { registerPushEffects } from './register';

/**
 * The push effect of the entries (owner, 2026-10-08). server/core/deps.ts imports this module for its side effect, as it does the
 * mail, Auth and file effects, so every entry (api, mcp, jobs) has the push.notify handler and the push producers exactly once.
 * A test that wants them on its own calls registerPushEffects() instead.
 */
registerPushEffects();
