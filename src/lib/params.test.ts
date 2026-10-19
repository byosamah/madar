import { describe, expect, it } from 'vitest';
import { chatLink, clientParam, dayParam, messageParam, oneOf, userParam } from './params';

describe('link values', () => {
  it('keeps a known value and falls back on anything else', () => {
    expect(oneOf('quarter', ['month', 'quarter'] as const, 'month')).toBe('quarter');
    expect(oneOf('decade', ['month', 'quarter'] as const, 'month')).toBe('month');
    expect(oneOf(null, ['month', 'quarter'] as const, 'month')).toBe('month');
  });

  it('keeps a real day only', () => {
    expect(dayParam('2026-09-30')).toBe('2026-09-30');
    expect(dayParam('banana')).toBeUndefined();
    expect(dayParam('2026-02-31')).toBeUndefined();
    expect(dayParam(null)).toBeUndefined();
  });

  it('keeps a person or a client id only when it has the form of one (owner, 2026-10-06)', () => {
    expect(userParam('usr_002')).toBe('usr_002');
    expect(userParam('nobody')).toBeUndefined();
    expect(userParam(null)).toBeUndefined();
    expect(clientParam('cli_001')).toBe('cli_001');
    expect(clientParam('usr_001')).toBeUndefined();
    expect(clientParam('')).toBeUndefined();
  });

  it('links a chat or a task thread, and one message in it', () => {
    expect(chatLink('cnv_001')).toBe('/inbox/cnv_001');
    expect(chatLink('cnv_001', 'msg_042')).toBe('/inbox/cnv_001?at=msg_042');
    expect(chatLink('tsk_007', 'cmt_013')).toBe('/inbox/tsk_007?at=cmt_013');
  });

  it('reads a message or a comment id from the link, and nothing else', () => {
    expect(messageParam('msg_042')).toBe('msg_042');
    expect(messageParam('cmt_013')).toBe('cmt_013');
    for (const bad of [null, '', 'msg_1', 'tsk_001', 'msg_042x', '<b>']) expect(messageParam(bad)).toBeUndefined();
  });
});
