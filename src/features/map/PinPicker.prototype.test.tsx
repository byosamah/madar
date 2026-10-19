import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { PinPicker } from './PinPicker';

// The prototype build has no map, so it has no place search either (Task 12b, fbk_017). The flag is folded at build time.
vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'fake');
});

describe('PinPicker in the prototype build (fbk_017)', () => {
  it('shows the paste field and no place search', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/^Paste a Google Maps link/)).toBeTruthy();
    expect(screen.queryByLabelText(/Search a place/)).toBeNull();
  });

  it('sets the pin from a pasted address, and says when it cannot read a text', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^Paste a Google Maps link/), { target: { value: '26.28, 50.21' } });
    expect(onChange).toHaveBeenLastCalledWith({ lat: 26.28, lng: 50.21 });
    fireEvent.change(screen.getByLabelText(/^Paste a Google Maps link/), { target: { value: 'Al Khobar' } });
    expect(screen.getByText('Madar cannot read a place in this text.')).toBeTruthy();
  });

  it('shows the old message for a short link, because the prototype has no server to follow it', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Paste a Google Maps link/), { target: { value: 'https://maps.app.goo.gl/AbC123' } });
    expect(screen.getByText(/Madar cannot read this short link now/)).toBeTruthy();
  });
});
