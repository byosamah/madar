import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { resetGate } from '../../lib/nominatimGate';
import { PinSheet } from './PinSheet';

// The real build looks up the address of the pin when the person presses "Use this place" (the Location is the address of the pin,
// owner, 2026-10-19). The map is a double here.
vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'remote');
});

vi.mock('./MapCanvas', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', { role: 'region', 'aria-label': 'Map' }) };
});

const FIELD = 'Search a place or paste a Google Maps link';
const REVERSE = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=26.2834&lon=50.2105&zoom=17&accept-language=en';
const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const reverseCalls = () => fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/reverse'));
const KING_FAHD = { address: { road: 'King Fahd Road', city: 'Dammam', state: 'Eastern Province' } };

beforeEach(() => {
  resetGate();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function open(props: Partial<React.ComponentProps<typeof PinSheet>> = {}) {
  const onUse = vi.fn();
  const onOpenChange = vi.fn();
  await renderWithRuntime(<PinSheet open onOpenChange={onOpenChange} initial={null} onUse={onUse} {...props} />);
  const sheet = await screen.findByRole('dialog', { name: 'Pin on the map' });
  return { sheet, onUse, onOpenChange };
}
const type = (sheet: HTMLElement, text: string) => fireEvent.change(within(sheet).getByLabelText(FIELD), { target: { value: text } });
const useThisPlace = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: /^Use this place$|^Finding the address/ });

describe('PinSheet: the address of the pin (the Location is the address of the pin, 2026-10-19)', () => {
  it('asks OpenStreetMap once for the address when the person presses Use this place, and hands it over with the point', async () => {
    fetchMock.mockResolvedValue(answer(KING_FAHD));
    const { sheet, onUse } = await open();
    type(sheet, '26.2834, 50.2105');
    // The pin moves, and nothing is asked yet.
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(useThisPlace(sheet));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(onUse).toHaveBeenCalledWith({ lat: 26.2834, lng: 50.2105 }, 'King Fahd Road, Dammam');
    expect(reverseCalls()).toEqual([REVERSE]);
  });

  it('shows that it looks for the address, and does not let the person press twice', async () => {
    let finish: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    const { sheet, onUse } = await open();
    type(sheet, '26.2834, 50.2105');
    fireEvent.click(useThisPlace(sheet));
    const busy = await within(sheet).findByRole('button', { name: 'Finding the address' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(reverseCalls()).toHaveLength(1);
    finish(answer(KING_FAHD));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
  });

  it('uses the name of a search hit as the address, and sends no lookup', async () => {
    fetchMock.mockResolvedValue(answer([{ display_name: 'Corniche, Al Khobar, Eastern Province, Saudi Arabia', lat: '26.2834', lon: '50.2105' }]));
    const { sheet, onUse } = await open();
    type(sheet, 'Al Khobar Corniche');
    fireEvent.keyDown(within(sheet).getByLabelText(FIELD), { key: 'Enter' });
    const list = await within(sheet).findByRole('list', { name: 'Places found' });
    fireEvent.click(within(list).getAllByRole('button')[0]);
    fireEvent.click(useThisPlace(sheet));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(onUse).toHaveBeenCalledWith({ lat: 26.2834, lng: 50.2105 }, 'Corniche, Al Khobar');
    expect(reverseCalls()).toEqual([]);
  });

  it('looks up the address when the pin moved after a search hit', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/reverse') ? answer(KING_FAHD) : answer([{ display_name: 'Corniche, Al Khobar, Saudi Arabia', lat: '26.2834', lon: '50.2105' }])));
    const { sheet, onUse } = await open();
    type(sheet, 'Corniche');
    fireEvent.keyDown(within(sheet).getByLabelText(FIELD), { key: 'Enter' });
    const list = await within(sheet).findByRole('list', { name: 'Places found' });
    fireEvent.click(within(list).getAllByRole('button')[0]);
    type(sheet, '26.3, 50.1');
    fireEvent.click(useThisPlace(sheet));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onUse).toHaveBeenCalledWith({ lat: 26.3, lng: 50.1 }, 'King Fahd Road, Dammam');
  });

  it('saves the pin with an empty address when the lookup fails, and shows no error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { sheet, onUse } = await open();
    type(sheet, '26.2834, 50.2105');
    fireEvent.click(useThisPlace(sheet));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(onUse).toHaveBeenCalledWith({ lat: 26.2834, lng: 50.2105 }, '');
    expect(screen.queryByText(/failed|error/i)).toBeNull();
  });

  it('keeps the address of an unchanged pin, and sends no lookup', async () => {
    const { sheet, onUse } = await open({ initial: { lat: 26.2834, lng: 50.2105 }, address: 'Corniche, Al Khobar' });
    fireEvent.click(useThisPlace(sheet));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(onUse).toHaveBeenCalledWith({ lat: 26.2834, lng: 50.2105 }, 'Corniche, Al Khobar');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks up the address again when the person moves the pin of a project that had one', async () => {
    fetchMock.mockResolvedValue(answer(KING_FAHD));
    const { sheet, onUse } = await open({ initial: { lat: 26.3, lng: 50.1 }, address: 'Corniche, Al Khobar' });
    type(sheet, '26.2834, 50.2105');
    fireEvent.click(useThisPlace(sheet));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(onUse).toHaveBeenCalledWith({ lat: 26.2834, lng: 50.2105 }, 'King Fahd Road, Dammam');
  });

  it('drops the answer when the person presses Cancel while the address is looked up', async () => {
    let finish: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    const { sheet, onUse, onOpenChange } = await open();
    type(sheet, '26.2834, 50.2105');
    fireEvent.click(useThisPlace(sheet));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    finish(answer(KING_FAHD));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onUse).not.toHaveBeenCalled();
  });

  it('keeps the Use this place button off until a place is set', async () => {
    const { sheet } = await open();
    expect(useThisPlace(sheet)).toBeDisabled();
  });
});
