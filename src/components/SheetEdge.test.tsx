import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n } from '../i18n';
import { Sheet } from './Sheet';

beforeEach(() => {
  initI18n('en');
});
afterEach(() => vi.restoreAllMocks());

function phoneWidth() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(max-width: 639px)', media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }) as MediaQueryList);
}

// The owner (2026-10-05, item 5): the Export sheet of the Tracker showed a light strip outside its rounded corners. Vaul adds a
// strip in the colour of the sheet on the side of the screen edge, for a pull past the end. A side sheet floats 12 px from the
// edge and nobody pulls it, so the strip only showed in that gap.
describe('the edge of a sheet (owner, 2026-10-05, item 5)', () => {
  it('draws no strip beside a side sheet on a computer', async () => {
    render(<Sheet open onOpenChange={() => undefined} title="Export the log">Rows</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Export the log' });
    expect(sheet).toHaveClass('after:hidden');
  });

  it('draws no strip in Arabic either, where the sheet comes from the other side', async () => {
    document.documentElement.dir = 'rtl';
    try {
      render(<Sheet open onOpenChange={() => undefined} title="Export the log">Rows</Sheet>);
      const sheet = await screen.findByRole('dialog', { name: 'Export the log' });
      expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'left');
      expect(sheet).toHaveClass('after:hidden');
    } finally {
      document.documentElement.dir = 'ltr';
    }
  });

  it('keeps the strip under a bottom sheet on a phone, where a pull up past the end needs it', async () => {
    phoneWidth();
    render(<Sheet open onOpenChange={() => undefined} title="Export the log">Rows</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Export the log' });
    expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'bottom');
    expect(sheet).not.toHaveClass('after:hidden');
  });
});

// The owner (2026-10-06, layout): on a phone a toast covered the Start date field of a task sheet. While a sheet is open, the
// toasts show at the top of the screen (see toasts.test.tsx), so the bottom sheet leaves that strip free.
describe('the bottom sheet of a phone and the toasts (owner, 2026-10-06, layout)', () => {
  it('leaves a strip at the top of the screen, where the toasts show while a sheet is open', async () => {
    phoneWidth();
    render(<Sheet open onOpenChange={() => undefined} title="Export the log">Rows</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Export the log' });
    // A toast with Undo is 62 px high and sits 12 px from the top, so the strip is 84 px (5.25rem) below the safe area.
    expect(sheet).toHaveClass('max-h-[calc(100dvh_-_5.25rem_-_env(safe-area-inset-top))]');
    expect(sheet).not.toHaveClass('max-h-[92dvh]');
  });
});

// The owner (2026-10-06, layout): at 1440 px the task panel floated 12 px from the top and covered the end of the tab pill,
// where the bell and its red count sit (English: right; Arabic: left). A sheet on a desk now starts below the pill, so the
// whole pill stays in view and the bell stays pressable next to the panel. jsdom has no layout, so the test checks the rule.
describe('the top of a sheet on a computer (owner, 2026-10-06, layout)', () => {
  const BELOW_PILL = '[:root:has([data-pill])_&]:top-[5.25rem]';

  it('starts the non-blocking task panel below the tab pill', async () => {
    render(<Sheet open onOpenChange={() => undefined} title="Renew the licence" blocking={false}>Fields</Sheet>);
    const panel = await screen.findByRole('dialog', { name: 'Renew the licence' });
    expect(panel).toHaveClass(BELOW_PILL, 'top-3', 'bottom-3', 'end-3');
    expect(panel).not.toHaveClass('inset-y-3');
  });

  it('starts the blocking sheet below the tab pill too, in English and in Arabic', async () => {
    for (const dir of ['ltr', 'rtl']) {
      document.documentElement.dir = dir;
      try {
        const view = render(<Sheet open onOpenChange={() => undefined} title="Export the log">Rows</Sheet>);
        const sheet = await screen.findByRole('dialog', { name: 'Export the log' });
        expect(sheet).toHaveClass(BELOW_PILL, 'top-3', 'bottom-3', 'end-3');
        expect(sheet).not.toHaveClass('inset-y-3');
        view.unmount();
      } finally {
        document.documentElement.dir = 'ltr';
      }
    }
  });
});
