import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { initI18n } from '../i18n';
import { RichText } from './RichText';

initI18n('en');

describe('web addresses in rich text (design item 7)', () => {
  it('opens an outside address in a new tab, keeps its own direction, and wraps a long one', () => {
    render(<MemoryRouter><RichText body="الرابط: https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026" /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026' });
    expect(link).toHaveAttribute('href', 'https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('dir', 'ltr');
    expect(link).toHaveClass('break-all', 'text-link', 'underline');
  });
  it('opens a Madar address in the same tab', () => {
    const address = `${window.location.origin}/inbox`;
    render(<MemoryRouter><RichText body={`Open ${address}`} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: address });
    expect(link).toHaveAttribute('href', address);
    expect(link).not.toHaveAttribute('target');
  });
});

describe('the everyone words in rich text (fbk_041)', () => {
  it('draws @everyone, @all and @الجميع like a mention when the item named people, and keeps plain text otherwise', () => {
    const { container, rerender } = render(<MemoryRouter><RichText body="Hi @everyone and x@all.com, @الجميع" everyone /></MemoryRouter>);
    const chips = [...container.querySelectorAll('span.text-link')].map((node) => node.textContent);
    expect(chips).toEqual(['@everyone', '@الجميع']);
    rerender(<MemoryRouter><RichText body="Hi @everyone" /></MemoryRouter>);
    expect(container.querySelectorAll('span.text-link')).toHaveLength(0);
  });
});
