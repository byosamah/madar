import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as stub from '../../stubs/unusedClients';

/**
 * Performance audit 2026-10-21, FL-5. The remote build points @supabase/storage-js, @supabase/postgrest-js and
 * @supabase/functions-js at an empty stand-in (vite.config.ts; scripts/vite-config.test.ts pins the alias), so the supabase chunk
 * holds none of their code. These tests keep that safe: no screen may call the parts that are gone, and the stand-in must hold every name that supabase-js imports.
 */
const STUBBED = ['@supabase/storage-js', '@supabase/postgrest-js', '@supabase/functions-js'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Source of the screens, without tests and without the stand-in file. Comments stay: a comment never calls a client. */
const sources = walk('src').filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !file.includes('/test/'));
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the Supabase parts that the real screens leave out (FL-5)', () => {
  it('finds the source files, so a scan that matches nothing cannot pass by accident', () => {
    expect(sources.length).toBeGreaterThan(300);
    expect(sources).toContain('src/app/remote/supabase.ts');
  });

  it('uses no .from(, .rpc(, .storage or .functions of the Supabase client in the screens', () => {
    const files = sources.filter((file) => /SupabaseClient|createSupabase|@supabase\//.test(readFileSync(file, 'utf8')));
    expect(files).toContain('src/app/remote/channel.ts');
    expect(files).toContain('src/app/remote/presence.ts');
    const hits = files.flatMap((file) => {
      const text = withoutComments(readFileSync(file, 'utf8'));
      return [...text.matchAll(/\.(from|rpc)\(|\.(storage|functions)\b/g)].map((match) => `${file}: ${match[0]}`);
    });
    expect(hits).toEqual([]);
    // Whatever the file is, a call on the client by its usual names.
    const named = sources.flatMap((file) => {
      const text = withoutComments(readFileSync(file, 'utf8'));
      return [...text.matchAll(/\b(supabase|sb|client)\.(from|rpc|storage|functions)\b/g)].map((match) => `${file}: ${match[0]}`);
    });
    expect(named).toEqual([]);
  });

  it('has every name that supabase-js imports from the three packages', () => {
    const code = readFileSync('node_modules/@supabase/supabase-js/dist/index.mjs', 'utf8');
    const wanted = STUBBED.flatMap((pkg) => {
      const match = new RegExp(`import \\{([^}]*)\\} from "${pkg}"`).exec(code);
      expect(match, `supabase-js has an import line for ${pkg}`).not.toBeNull();
      return match![1].split(',').map((name) => name.trim()).filter(Boolean);
    });
    expect(wanted.length).toBeGreaterThan(8);
    for (const name of wanted) expect(Object.keys(stub), name).toContain(name);
    // The names that supabase-js exports again are the same ones.
    const exported = /export \{([^}]*)\}/.exec(code.slice(code.lastIndexOf('export {')));
    for (const name of exported![1].split(',').map((item) => item.trim()).filter((item) => /Error|FunctionRegion/.test(item))) expect(Object.keys(stub), name).toContain(name);
  });
});
