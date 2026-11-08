import { describe, expect, it } from 'vitest';
import { loggerOf } from '../core/deps';
import type { LogFields, Logger } from '../core/ports';
import { testConfig } from '../test/fakes/deps';
import { currentEnterprise, entLogger, runInEnterprise } from './context';

function recorder() {
  const lines: { level: string; message: string; fields?: LogFields }[] = [];
  const log: Logger = {
    info: (message, fields) => lines.push({ level: 'info', message, fields }),
    warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
    error: (message, fields) => lines.push({ level: 'error', message, fields }),
  };
  return { log, lines };
}

const later = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('the request scope and entLogger (Madar enterprises, design 5.16)', () => {
  it('adds ent from the request scope', () => {
    const { log, lines } = recorder();
    const out = entLogger(log, currentEnterprise);
    runInEnterprise('ent_002', () => out.info('A line.', { a: 1 }));
    runInEnterprise('ent_003', () => out.warn('Another.'));
    runInEnterprise('ent_004', () => out.error('Third.', undefined));
    expect(lines.map((l) => l.fields)).toEqual([{ a: 1, ent: 'ent_002' }, { ent: 'ent_003' }, { ent: 'ent_004' }]);
  });

  it('adds no field outside a scope', () => {
    const { log, lines } = recorder();
    const out = entLogger(log, currentEnterprise);
    out.info('A line.', { a: 1 });
    out.info('Bare.');
    expect(lines.map((l) => l.fields)).toEqual([{ a: 1 }, undefined]);
    expect(currentEnterprise()).toBeUndefined();
  });

  it('keeps the ent of two overlapping requests apart, across awaits', async () => {
    const { log, lines } = recorder();
    const out = entLogger(log, currentEnterprise);
    await Promise.all([
      runInEnterprise('ent_002', async () => {
        out.info('one start');
        await later();
        out.info('one end');
      }),
      runInEnterprise('ent_003', async () => {
        await later();
        out.info('two middle');
        await later();
        out.info('two end');
      }),
    ]);
    const byMessage = Object.fromEntries(lines.map((l) => [l.message, l.fields?.ent]));
    expect(byMessage).toEqual({ 'one start': 'ent_002', 'one end': 'ent_002', 'two middle': 'ent_003', 'two end': 'ent_003' });
  });

  it('does not replace an ent that the line sets', () => {
    const { log, lines } = recorder();
    const out = entLogger(log, currentEnterprise);
    runInEnterprise('ent_002', () => out.info('A line.', { ent: 'ent_005' }));
    expect(lines[0]!.fields).toEqual({ ent: 'ent_005' });
  });

  it('writes the line as it is when the getter throws', () => {
    const { log, lines } = recorder();
    const out = entLogger(log, () => {
      throw new Error('The gate has not loaded a row.');
    });
    out.info('A line.', { a: 1 });
    expect(lines[0]!.fields).toEqual({ a: 1 });
  });

  it('loggerOf adds the ent of the scope first, then the ent of the config, and nothing for a config with none', () => {
    const lines: string[] = [];
    const real = console.log;
    console.log = (text: string) => void lines.push(text);
    try {
      const withConfig = loggerOf(testConfig({ ent: 'ent_009' }));
      const none = loggerOf(testConfig());
      withConfig.info('config line');
      runInEnterprise('ent_002', () => withConfig.info('scope line'));
      none.info('no ent line');
      runInEnterprise('ent_003', () => none.info('scope only line'));
    } finally {
      console.log = real;
    }
    const parsed = lines.map((l) => JSON.parse(l) as { message: string; ent?: string });
    expect(parsed).toEqual([
      { level: 'info', message: 'config line', ent: 'ent_009' },
      { level: 'info', message: 'scope line', ent: 'ent_002' },
      { level: 'info', message: 'no ent line' },
      { level: 'info', message: 'scope only line', ent: 'ent_003' },
    ]);
  });
});
