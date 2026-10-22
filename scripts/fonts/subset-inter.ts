import { spawnSync } from 'node:child_process';
import { copyFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Makes the small Inter file of the number spots and the middle dot (performance audit BND-M2): node scripts/fonts/subset-inter.ts.
 * The faces "Madar Dot" (U+00B2 and U+00B7) and "Madar Digits" (U+0030-0039) in src/design/tokens.css took them from the full Latin file
 * of Inter (72,920 B). The subset holds only these 12 characters (the square sign U+00B2 for m2 joined at the speed audit of 2026-10-21, LV-11), with every layout feature (tnum for the tabular figures),
 * the wght and opsz axes and every name record. fontTools (pyftsubset 4.63) found the same outlines, widths and vertical
 * metrics for every kept glyph at wght 100 to 900 and opsz 14 to 32. Inter is under the SIL Open Font License 1.1 with no
 * Reserved Font Name, so a subset is allowed, and its licence goes next to the file. The Thmanyah files are never subset (licence).
 * It needs pyftsubset and the brotli module of Python (pip install fonttools brotli). scripts/fonts/subset-inter.test.ts pins
 * the result.
 */
export const INTER_SOURCE = 'node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2';
export const SUBSET_FILE = 'src/design/inter/inter-digits-dot.woff2';
export const LICENCE_FILE = 'src/design/inter/OFL.txt';

/** The pyftsubset arguments: the 12 characters, every layout feature, every name record, WOFF2. */
export function subsetArgs(input: string, output: string): string[] {
  return [input, '--unicodes=U+0030-0039,U+00B2,U+00B7', '--layout-features=*', '--name-IDs=*', '--flavor=woff2', `--output-file=${output}`];
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const run = spawnSync('pyftsubset', subsetArgs(INTER_SOURCE, SUBSET_FILE), { cwd: root, stdio: 'inherit' });
  if (run.error || run.status !== 0) {
    console.error('pyftsubset failed. Install fontTools and brotli: pip install fonttools brotli.');
    process.exit(1);
  }
  copyFileSync(join(root, 'node_modules/@fontsource-variable/inter/LICENSE'), join(root, LICENCE_FILE));
  console.log(`Wrote ${SUBSET_FILE} and ${LICENCE_FILE}.`);
}
