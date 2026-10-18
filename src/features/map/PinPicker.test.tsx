import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { PinPicker } from './PinPicker';

// The prototype build shows the paste field only (no map), so these tests run the paste field.
describe('PinPicker (fbk_017)', () => {
  it('sets the pin from a pasted Google Maps address', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Paste a Google Maps link/), { target: { value: 'https://www.google.com/maps/@26.2834,50.2105,17z' } });
    expect(onChange).toHaveBeenLastCalledWith({ lat: 26.2834, lng: 50.2105 });
    expect(screen.getByText('The pin is set from this text.')).toBeTruthy();
  });

  it('shows the short-link message and sets no pin for a short Google Maps link', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Paste a Google Maps link/), { target: { value: 'https://maps.app.goo.gl/AbC123' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/This is a short link/)).toBeTruthy();
  });

  it('says that it cannot read a place in text with no coordinates, and sets no pin', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Paste a Google Maps link/), { target: { value: 'Al Khobar Corniche' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Madar cannot read a place in this text.')).toBeTruthy();
  });

  it('shows the pin that is set, as latitude and longitude', async () => {
    await renderWithRuntime(<PinPicker value={{ lat: 26.28, lng: 50.21 }} onChange={vi.fn()} />);
    expect(screen.getByText('26.28, 50.21')).toBeTruthy();
  });
});
