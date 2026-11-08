import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from '../../server/mcp/docs';
import { PARITY_DOCS } from '../../server/mcp/docsParity';
import { ar, en } from './trees';

/**
 * No word that a person reads, and no text that an agent reads, names VADO content: the names of the office group, its brands or its city
 * (design D1). Every enterprise sees the same words. The list of what stays, with the reason, is in server/enterprise/CLAUDE.md, section
 * "The sweep of VADO text". ALLOWED holds a key path and its owner reason. It is empty on purpose: every new entry needs the owner's reason.
 */
const VADO_TEXT = /vado|bunah|khobar|\bKH\b|الخبر|فادو|بناه/i;
const ALLOWED: Record<string, string> = {};

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, path: string[] = []): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [[[...path, key].join('.'), value] as [string, string]] : leaves(value, [...path, key])));
}

function offenders(entries: [string, string][]): string[] {
  return entries.filter(([key, text]) => VADO_TEXT.test(text) && !(key in ALLOWED)).map(([key, text]) => `${key}: ${text.slice(0, 80)}`);
}

describe('the words name no VADO content (design D1)', () => {
  it('the English words', () => expect(offenders(leaves(en as Tree))).toEqual([]));
  it('the Arabic words', () => expect(offenders(leaves(ar as Tree))).toEqual([]));
  it('the instructions for agents', () => expect(offenders([['INSTRUCTIONS', INSTRUCTIONS]])).toEqual([]));
  it('the descriptions of the agent tools', () => {
    const docs = Object.entries({ ...TOOL_DOCS, ...PARITY_DOCS }).flatMap(([name, doc]) => [[`${name}.title`, doc.title], [`${name}.description`, doc.description]] as [string, string][]);
    expect(offenders(docs)).toEqual([]);
  });
  it('catches a name of VADO content, in both languages', () => {
    expect(offenders([['a', 'Vado Tower'], ['b', 'Bunah'], ['c', 'Al Khobar'], ['d', 'for example KH.'], ['e', 'شركات فادو'], ['f', 'بناه'], ['g', 'مثل AB']])).toHaveLength(6);
  });
  it('holds no allowed entry without a reason', () => {
    for (const [key, reason] of Object.entries(ALLOWED)) expect({ key, reason: reason.trim() === '' }).toEqual({ key, reason: false });
  });
});
