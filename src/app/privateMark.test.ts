import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRIVATE } from './privateMark';

/**
 * Insight design, section 5, rule 2. A file that makes a signed file link must also use the private mark, so a replay and a click
 * record never hold a client picture or its link. A new file that uses a file link without the mark fails here at once.
 */
const SOURCES = globSync('src/**/*.{ts,tsx}').filter((file) => !/\.test\.tsx?$/.test(file) && !file.endsWith('src/app/files.ts'));
const read = (file: string) => readFileSync(file, 'utf8');

describe('the private mark', () => {
  it('is the class that PostHog leaves out of its records', () => {
    expect(PRIVATE).toBe('ph-no-capture');
  });

  it('is in every file that calls useFileLink or useScreenshotLink', () => {
    const users = SOURCES.filter((file) => /\buse(File|Screenshot)Link\(/.test(read(file)));
    expect(users.length).toBeGreaterThanOrEqual(6);
    expect(users.filter((file) => !read(file).includes('PRIVATE'))).toEqual([]);
  });

  it('is in every file that calls useFileUrl', () => {
    const users = SOURCES.filter((file) => /\buseFileUrl\(/.test(read(file)));
    expect(users.length).toBeGreaterThanOrEqual(1);
    expect(users.filter((file) => !read(file).includes('PRIVATE'))).toEqual([]);
  });

  it('is in the image viewer', () => {
    expect(read('src/components/ImageViewer.tsx')).toContain('PRIVATE');
  });

  it('is in every place that shows the words of a message', () => {
    const places = ['src/components/RichText.tsx', 'src/features/inbox/ChatList.tsx', 'src/features/inbox/ReplyStrip.tsx', 'src/features/search/MessageHits.tsx', 'src/features/inbox/MessageMenu.tsx', 'src/features/notifications/NotificationsScreen.tsx'];
    expect(places.filter((file) => !read(file).includes('PRIVATE'))).toEqual([]);
  });

  it('is in every place that shows an amount of money', () => {
    const places = ['src/features/project/payments/PaymentsPanel.tsx', 'src/features/project/payments/DaftraPart.tsx', 'src/features/project/overview/OverviewTab.tsx', 'src/features/dashboard/MoneyPanel.tsx'];
    expect(places.filter((file) => !read(file).includes('PRIVATE'))).toEqual([]);
  });

  it('is in every file that calls amountText', () => {
    const users = SOURCES.filter((file) => /\bamountText\(/.test(read(file)));
    expect(users.filter((file) => !read(file).includes('PRIVATE'))).toEqual([]);
  });
});
