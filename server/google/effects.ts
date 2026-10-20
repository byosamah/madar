import { registerGoogleEffects } from './register';

/**
 * The Google Calendar effects of the entries (fbk_022). server/core/deps.ts imports this module for its side effect, as it does the
 * mail, push, Auth and file effects, so every entry (api, mcp, jobs) has the gcal.sync and gcal.revoke handlers and the producers
 * exactly once. A test that wants them on its own calls registerGoogleEffects() instead.
 */
registerGoogleEffects();
