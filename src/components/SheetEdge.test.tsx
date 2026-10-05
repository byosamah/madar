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
