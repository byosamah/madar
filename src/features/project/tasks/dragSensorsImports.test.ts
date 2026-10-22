import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// RowGrip, SortableTaskRows and TaskRowItem are first-load files. dnd-kit is about 18 KB of script (FL-2), so they must not pull it in.
const FILES = ['RowGrip.tsx', 'SortableTaskRows.tsx', 'TaskRowItem.tsx', 'useTouchPhone.ts', 'TaskPeople.tsx'];

describe('the first-load files of the task rows', () => {
  for (const file of FILES) {
    const text = readFileSync(`src/features/project/tasks/${file}`, 'utf8');
    it(`${file} does not import dragSensors`, () => {
      expect(text).not.toMatch(/^import\s[^;]*from\s+'[^']*dragSensors'/m);
    });
    it(`${file} imports no value of dnd-kit`, () => {
      expect(text).not.toMatch(/^import\s(?!type\b)[^;]*from\s+'@dnd-kit/m);
    });
  }
});
