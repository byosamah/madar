import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoLeadMark } from './NoLeadMark';
import { initI18n } from '../i18n';

describe('the mark of a task with no lead (owner, 2026-10-05)', () => {
  it('is an empty dashed circle with the name "No lead", at the size of the picture it replaces', () => {
    initI18n('en');
    render(<NoLeadMark size={26} />);
    const mark = screen.getByRole('img', { name: 'No lead' });
    expect(mark.textContent).toBe('');
    expect(mark.className).toContain('border-dashed');
    expect(mark.className).toContain('rounded-full');
    expect(mark.style.width).toBe('26px');
    expect(mark.style.height).toBe('26px');
  });
});
