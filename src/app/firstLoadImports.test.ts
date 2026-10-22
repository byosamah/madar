import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Performance audit 2026-10-21, FL-1 and FL-4. These parts load in their own chunk, so the first load of the real build holds
 * none of them. One static import brings the whole chunk back into the first script. The bundle rules in
 * scripts/check-bundles.ts catch the same fault in a finished build; this test names the file at once.
 */
const STATIC_IMPORT = (module: string) => new RegExp(`^import\\s[^;]*from\\s+'[^']*${module}'`, 'm');
const read = (path: string) => readFileSync(path, 'utf8');

const LAZY_PARTS: { file: string; module: string; part: string }[] = [
  { file: 'src/features/home/HomeScreen.tsx', module: 'project/tasks/TaskSheet', part: 'the task panel (FL-1)' },
  { file: 'src/app/AppShell.tsx', module: 'focus/FocusMode', part: 'Focus mode (FL-4)' },
  { file: 'src/app/PersonMenu.tsx', module: 'feedback/FeedbackSheet', part: 'the feedback sheet (FL-4)' },
  { file: 'src/features/auth/AuthGate.tsx', module: 'SessionExpiredSheet', part: 'the session expired sheet (FL-4)' },
  { file: 'src/components/Menu.tsx', module: 'MenuSheet', part: 'the menu sheet' },
  { file: 'src/components/Menu.tsx', module: 'Sheet', part: 'the sheet (vaul stays in the overlay chunk)' },
];

describe('parts that load on their first use', () => {
  it.each(LAZY_PARTS)('$file has no static import of $part', ({ file, module }) => {
    expect(read(file)).not.toMatch(STATIC_IMPORT(module));
  });

  it('the lazy wrappers import each part by dynamic import', () => {
    const overlays = read('src/app/overlays.tsx');
    expect(overlays).toMatch(/import\('\.\.\/features\/focus\/FocusMode'\)/);
    expect(overlays).toMatch(/import\('\.\.\/features\/feedback\/FeedbackSheet'\)/);
    expect(overlays).toMatch(/import\('\.\.\/features\/auth\/SessionExpiredSheet'\)/);
    expect(read('src/features/home/HomeTaskSheet.tsx')).toMatch(/import\('\.\.\/project\/tasks\/TaskSheet'\)/);
    expect(read('src/components/Menu.tsx')).toMatch(/import\('\.\/MenuSheet'\)/);
  });
});
