import { registerUsageEffects } from './register';

/**
 * The usage effect of the entries (task M1). server/core/deps.ts imports the usage meter, and server/usage/meter.ts imports
 * this module for its side effect, so every entry (api, mcp, jobs) has the usage.limitWarning handler exactly once, and the job
 * can retry its rows. A test that wants it on its own calls registerUsageEffects() instead.
 */
registerUsageEffects();
