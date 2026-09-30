import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPhysicalDirection } from '../src/lib/rtl-check.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const EXTENSIONS = ['.ts', '.tsx', '.css'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    const scanned = EXTENSIONS.some((ext) => name.endsWith(ext)) && !name.includes('.test.') && !path.endsWith('rtl-check.ts');
    return scanned ? [path] : [];
  });
}

const findings = walk(join(root, 'src')).flatMap((file) =>
  findPhysicalDirection(readFileSync(file, 'utf8')).map((f) => `${relative(root, file)}:${f.line}  ${f.rule}  "${f.match}"`),
);

if (findings.length > 0) {
  console.error(`Physical left or right styles found. Use start and end instead:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('RTL check passed.');
