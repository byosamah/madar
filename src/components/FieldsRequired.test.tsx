import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n } from '../i18n';
import { SelectField, TextArea, TextField } from './Fields';

describe('a required field (item 1)', () => {
  it('shows an asterisk after the label, and keeps the label text as it is', () => {
    initI18n('en');
    render(<TextField id="name" label="Name" required value="" onChange={() => undefined} />);
    const input = screen.getByLabelText('Name');
    const mark = screen.getByText('*');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark.previousElementSibling).toBe(document.querySelector('label[for="name"]'));
  });

  it('gives screen readers a hidden "required" word', () => {
    initI18n('en');
    render(<TextField id="name" label="Name" required hint="Your full name." value="" onChange={() => undefined} />);
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('required Your full name.');
    expect(screen.getByText('required')).toHaveClass('sr-only');
  });

  it('says "required" in Arabic on an Arabic screen', () => {
    initI18n('ar');
    render(<TextField id="name" label="الاسم" required value="" onChange={() => undefined} />);
    expect(screen.getByLabelText('الاسم')).toHaveAccessibleDescription('مطلوب');
    initI18n('en');
  });

  it('never asks the browser to check the field, so the form shows its own messages', () => {
    initI18n('en');
    render(<TextField id="name" label="Name" required value="" onChange={() => undefined} />);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('required');
  });

  it('marks a select and a text area the same way', () => {
    initI18n('en');
    render(
      <>
        <SelectField id="kind" label="Kind" required value="" onChange={() => undefined}><option value="">Choose</option></SelectField>
        <TextArea id="note" label="Note" required value="" onChange={() => undefined} />
      </>,
    );
    expect(screen.getAllByText('*')).toHaveLength(2);
    expect(screen.getByLabelText('Kind')).toHaveAccessibleDescription('required');
    expect(screen.getByLabelText('Note')).toHaveAccessibleDescription('required');
  });

  it('shows no mark on a field that is not required', () => {
    initI18n('en');
    render(<TextField id="place" label="Place" value="" onChange={() => undefined} />);
    expect(screen.queryByText('*')).toBeNull();
    expect(screen.getByLabelText('Place')).not.toHaveAccessibleDescription();
  });
});
