import { describe, expect, it } from 'vitest';
import { PLATFORM_CALL_NAMES } from '../../src/api/contract/platform';
import { MCP_ADMIN, MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, mcpTools } from './tools';
import { call, world } from './bulk.testing';
import { buildSeed } from '../../src/data/seed';

/** Madar enterprises (plan C): an AI agent never creates, pauses or changes an enterprise, and never sees the platform part. */
describe('the platform calls and the MCP server', () => {
  it('MCP_DENY holds all 8 platform calls, and no other list holds one', () => {
    for (const name of PLATFORM_CALL_NAMES) {
      expect(MCP_DENY as readonly string[], name).toContain(name);
      for (const list of [MCP_ALLOW, MCP_ADMIN, Object.keys(MCP_BY_RIGHT)] as readonly (readonly string[])[]) expect(list, name).not.toContain(name);
    }
  });

  it('no tool of the list for an Admin, or for anybody, starts with platform.', () => {
    for (const admin of [true, false]) expect(mcpTools({ admin }).filter((tool) => tool.name.startsWith('platform.'))).toEqual([]);
  });

  it('answers an unknown tool for each of the 8 names in a tools/call', async () => {
    const w = world(await buildSeed('2026-10-04', async () => undefined), 'usr_001');
    for (const name of PLATFORM_CALL_NAMES) {
      await expect(call(w, name, {}), name).rejects.toThrow(`Tool ${name} not found`);
    }
  });
});
