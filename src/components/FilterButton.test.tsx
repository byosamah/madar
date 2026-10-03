import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { FilterButton } from './FilterButton';
import { initI18n } from '../i18n';

describe('the Filter button', () => {
  it('gives its icon lines a number in every state, also when it opens as its icon starts (audit 2026-10-03, V-31)', async () => {
    initI18n('en');
    const written: string[] = [];
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name: string, value: string) {
      if (this.tagName.toLowerCase() === 'line' && (value === undefined || String(value) === 'undefined')) written.push(name);
      return original.call(this, name, value);
    };
    try {
      render(<FilterButton label="Filter" count={0}><p>Choices</p></FilterButton>);
      const button = screen.getByRole('button', { name: 'Filter' });
      // The focus starts the icon, and the press opens the pop-over in the same moment, before the first frame.
      act(() => {
        button.focus();
        button.click();
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    } finally {
      Element.prototype.setAttribute = original;
    }
    expect(written).toEqual([]);
  });
});
