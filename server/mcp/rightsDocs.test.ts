import { describe, expect, it } from 'vitest';
import { TOOL_DOCS } from './docs';

/** The payment tools name the payment right, because a custom role may hold it (owner, 2026-10-18, fbk_014). */
const PAYMENT_TOOLS = ['payments.create', 'payments.list', 'payments.markReceived', 'payments.update'];

describe('the agent docs of the payment right (fbk_014)', () => {
  it('name the payment right, with its default holders, in each payment tool', () => {
    for (const name of PAYMENT_TOOLS) {
      expect(TOOL_DOCS[name].description, name).toContain('Needs the payment right (by default the Admin, Management and Accounting).');
    }
  });

  it('no longer say that only the three roles may use the payment tools', () => {
    for (const name of PAYMENT_TOOLS) {
      expect(TOOL_DOCS[name].description, name).not.toContain('Only the Admin, Management and Accounting');
    }
  });
});
