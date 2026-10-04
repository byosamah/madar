import { registerMailEffects } from './register';

/**
 * The mail effects of the entries (task N2.2). server/core/deps.ts imports this module for its side effect, as it does the Auth
 * and file effects, so every entry (api, mcp, jobs) has the mail.notice and mail.quotaWarning handlers and the notice producers
 * exactly once. A test that wants them on its own calls registerMailEffects() instead.
 */
registerMailEffects();
