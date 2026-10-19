import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { PinSheet } from './PinSheet';

// The prototype has no network lookup (the Location is the address of the pin, 2026-10-19): the pin saves with an empty address.
vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'fake');
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('PinSheet in the prototype build', () => {
  it('hands over the point with an empty address, and sends no request', async () => {
    const onUse = vi.fn();
    await renderWithRuntime(<PinSheet open onOpenChange={vi.fn()} initial={null} onUse={onUse} />);
    const sheet = await screen.findByRole('dialog', { name: 'Pin on the map' });
    fireEvent.change(within(sheet).getByLabelText(/^Paste a Google Maps link/), { target: { value: '26.28, 50.21' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use this place' }));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(onUse).toHaveBeenCalledWith({ lat: 26.28, lng: 50.21 }, '');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
