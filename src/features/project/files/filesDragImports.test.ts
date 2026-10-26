import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Files & Links tab is first-load code for the project page. dnd-kit is about 18 KB of script (FL-2), so only FilesDragLayer.tsx imports it, and
// the other files load that layer with a dynamic import (filesDragLoader.ts) and take its types only.
const FILES = ['FilesTab.tsx', 'FileRow.tsx', 'FileGroups.tsx', 'fileDragSlots.tsx', 'MoveFileSheet.tsx', 'FolderNameField.tsx', 'filesDragLoader.ts'];

describe('the first-load files of the Files & Links list', () => {
  for (const file of FILES) {
    const text = readFileSync(`src/features/project/files/${file}`, 'utf8');
    it(`${file} imports no value of dnd-kit`, () => {
      expect(text).not.toMatch(/^import\s(?!type\b)[^;]*from\s+'@dnd-kit/m);
    });
    it(`${file} imports no value of the drag layer`, () => {
      expect(text).not.toMatch(/^import\s(?!type\b)[^;]*from\s+'\.\/FilesDragLayer'/m);
    });
  }

  it('loads the layer with a dynamic import in the loader only', () => {
    expect(readFileSync('src/features/project/files/filesDragLoader.ts', 'utf8')).toMatch(/import\('\.\/FilesDragLayer'\)/);
  });
});
