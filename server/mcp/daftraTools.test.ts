import { describe, expect, it } from 'vitest';
import { OFFICE_RIGHTS } from '../../src/api/permissions';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ADMIN, MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, mcpTools } from './tools';

/** The Daftra link (owner, 2026-10-26): an agent never touches Daftra. The six calls are on the deny list; the docs say what an agent sees. */
const DAFTRA_CALLS = ['daftra.status', 'daftra.paymentLink', 'daftra.findClients', 'daftra.matchClient', 'payments.linkInvoice', 'payments.unlinkInvoice'];

describe('the agent tools and the Daftra link', () => {
  it('keeps the six Daftra calls on the deny list, and on no list of tools', () => {
    for (const name of DAFTRA_CALLS) {
      expect(MCP_DENY as readonly string[], name).toContain(name);
      expect(MCP_ALLOW as readonly string[], name).not.toContain(name);
      expect(MCP_ADMIN as readonly string[], name).not.toContain(name);
      expect(Object.keys(MCP_BY_RIGHT), name).not.toContain(name);
    }
  });

  it('shows no Daftra tool to any agent, not even to the agent of an Admin who holds every right and every AI switch', () => {
    const every = OFFICE_RIGHTS;
    for (const list of [mcpTools(), mcpTools({ admin: true }), mcpTools({ rights: every }), mcpTools({ admin: true, rights: every })]) {
      const names = list.map((tool) => tool.name);
      for (const name of DAFTRA_CALLS) expect(names, name).not.toContain(name);
      expect(names.filter((name) => /daftra/i.test(name))).toEqual([]);
    }
  });

  it('keeps the count of tools as it was: 49 allowed, 12 for a right, 61 for an Admin', () => {
    expect(MCP_ALLOW).toHaveLength(49);
    expect(mcpTools({ admin: true, rights: OFFICE_RIGHTS })).toHaveLength(61);
  });

  it('tells the agent in payments.list that a linked payment has a read-only daftra field, with the invoice number and the total', () => {
    const text = TOOL_DOCS['payments.list'].description;
    for (const word of ['"daftra" field', 'invoiceNo', 'total with VAT', 'only read']) expect(text, word).toContain(word);
  });

  it('tells the agent in payments.markReceived that Daftra sets Received for a linked payment by itself', () => {
    const text = TOOL_DOCS['payments.markReceived'].description;
    for (const word of ['"daftra" field', 'gets Received from Daftra by itself', 'leave such a payment alone']) expect(text, word).toContain(word);
  });

  it('has one short Daftra rule in the instructions: a person links in the screens, Daftra sets Received, agents cannot link or unlink', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Daftra:'));
    expect(line).toBe('Daftra: a payment can be linked to a Daftra invoice in the Madar screens. Daftra then sets Received. Agents cannot link or unlink.');
    expect(INSTRUCTIONS.split('\n').filter((text) => text.startsWith('Daftra:'))).toHaveLength(1);
  });

  it('puts no account name, key or site in any text of the agent docs', () => {
    const everything = `${INSTRUCTIONS}\n${Object.values(TOOL_DOCS).map((doc) => doc.description).join('\n')}`;
    expect(everything).not.toMatch(/DAFTRA_[A-Z0-9]+_(KEY|SITE)|apikey|api2/);
  });
});
