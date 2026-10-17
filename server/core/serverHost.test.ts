import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COPIES,
  COPY_HOSTS,
  PAGE_HOSTS,
  PROJECT_REFS,
  SERVER_HOST_SETTING,
  copyOfPageHost,
  copyOfSupabaseUrl,
  onWorker,
  parseServerHostSetting,
  screensApiUrl,
  serverHostOf,
} from './serverHost';

/** config/server-host.json and its resolver (owner, 2026-10-16): one word for each copy picks one of two fixed targets. */
const TEST = 'qdgwpnesxppnqsaabqzd';
const PRODUCTION = 'oprkvdjudjxxhvodkzgs';
const raw = JSON.parse(readFileSync(new URL('../../config/server-host.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('config/server-host.json', () => {
  it('holds only the two copies, each with one of the two words', () => {
    expect(Object.keys(raw).sort()).toEqual(['production', 'test']);
    for (const value of Object.values(raw)) expect(['supabase', 'workers']).toContain(value);
  });

  it('is the setting that the resolver reads', () => {
    expect(SERVER_HOST_SETTING).toEqual(raw);
  });
});

describe('parseServerHostSetting', () => {
  it('takes the two copies with the two words', () => {
    expect(parseServerHostSetting({ test: 'workers', production: 'supabase' })).toEqual({ test: 'workers', production: 'supabase' });
  });

  it('refuses another key, a missing copy, another word and a value that is not an object', () => {
    expect(() => parseServerHostSetting({ test: 'workers', production: 'supabase', staging: 'workers' })).toThrow(/staging/);
    expect(() => parseServerHostSetting({ test: 'workers' })).toThrow(/production/);
    expect(() => parseServerHostSetting({ test: 'worker', production: 'supabase' })).toThrow(/test.*supabase, workers or office/);
    expect(() => parseServerHostSetting({ test: 'Workers', production: 'supabase' })).toThrow(/supabase, workers or office/);
    for (const value of [null, 'workers', ['workers'], 1]) expect(() => parseServerHostSetting(value)).toThrow(/object/);
  });
});

describe('the fixed tables of each copy', () => {
  it('names the project of each copy, and only that project', () => {
    expect(PROJECT_REFS).toEqual({ test: TEST, production: PRODUCTION });
    for (const copy of COPIES) {
      const own = PROJECT_REFS[copy];
      const other = copy === 'test' ? PRODUCTION : TEST;
      const text = JSON.stringify(COPY_HOSTS[copy]);
      expect(text).toContain(own);
      expect(text).not.toContain(other);
      expect(COPY_HOSTS[copy].supabaseUrl).toBe(`https://${own}.supabase.co`);
      expect(COPY_HOSTS[copy].supabase).toEqual({
        api: `https://${own}.supabase.co/functions/v1/api`,
        mcp: `https://${own}.supabase.co/functions/v1/mcp`,
      });
    }
  });

  it('gives each copy its own Worker, Pages binding and Hyperdrive config', () => {
    expect(COPY_HOSTS.test.workers).toEqual({ name: 'madar-server-test', binding: 'MADAR_SERVER_TEST', hyperdrive: 'madar-db-test' });
    expect(COPY_HOSTS.production.workers).toEqual({ name: 'madar-server-production', binding: 'MADAR_SERVER_PRODUCTION', hyperdrive: 'madar-db-production' });
  });

  it('maps the page hosts to their copy: a production host never reaches the test copy', () => {
    expect(PAGE_HOSTS).toEqual({
      'madar.vado.sa': 'production',
      'www.madar.vado.sa': 'production',
      'madar-46r.pages.dev': 'production',
      'preview.madar-46r.pages.dev': 'test',
    });
    expect(copyOfPageHost('madar.vado.sa')).toBe('production');
    expect(copyOfPageHost('preview.madar-46r.pages.dev')).toBe('test');
    for (const host of ['abc123.madar-46r.pages.dev', 'evil.example', 'MADAR.VADO.SA.evil.example', '', 'constructor', '__proto__']) {
      expect(copyOfPageHost(host), host).toBeUndefined();
    }
    expect(COPY_HOSTS.test.page).toBe('https://preview.madar-46r.pages.dev');
    expect(COPY_HOSTS.production.page).toBe('https://madar.vado.sa');
  });

  it('finds the copy of a Supabase project URL, and no copy for a local or other URL', () => {
    expect(copyOfSupabaseUrl(`https://${TEST}.supabase.co`)).toBe('test');
    expect(copyOfSupabaseUrl(`https://${PRODUCTION}.supabase.co/`)).toBe('production');
    for (const url of ['http://127.0.0.1:54321', 'http://kong:8000', `https://${TEST}.supabase.co.evil.example`, 'not a url', '']) {
      expect(copyOfSupabaseUrl(url), url).toBeUndefined();
    }
  });
});

describe('the host of each copy', () => {
  it('reads the word of the copy', () => {
    const setting = { test: 'workers', production: 'supabase' } as const;
    expect(serverHostOf('test', setting)).toBe('workers');
    expect(serverHostOf('production', setting)).toBe('supabase');
  });

  it('gives the screens the page address on the Worker, and the api function on Supabase', () => {
    expect(screensApiUrl('test', 'workers')).toBe('/api');
    expect(screensApiUrl('production', 'workers')).toBe('/api');
    expect(screensApiUrl('test', 'supabase')).toBe(`https://${TEST}.supabase.co/functions/v1/api`);
    expect(screensApiUrl('production', 'supabase')).toBe(`https://${PRODUCTION}.supabase.co/functions/v1/api`);
  });
});

describe('the host word office (exit wave 4)', () => {
  it('reads office for the test copy, and the screens of an office copy call the page api', () => {
    expect(parseServerHostSetting({ test: 'office', production: 'supabase' })).toEqual({ test: 'office', production: 'supabase' });
    expect(screensApiUrl('test', 'office')).toBe('/api');
    expect([onWorker('supabase'), onWorker('workers'), onWorker('office')]).toEqual([false, true, true]);
  });

  it('refuses production: office until wave 6, with a message that names the wave', () => {
    expect(() => parseServerHostSetting({ test: 'office', production: 'office' })).toThrow(/production.*wave 6/);
  });

  it('names the three words in the message of a wrong word', () => {
    expect(() => parseServerHostSetting({ test: 'pages', production: 'supabase' })).toThrow('test must be supabase, workers or office.');
  });
});
