import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { PinPicker } from './PinPicker';

// The real build shows the map (a double here) and the place search. The one field shows in both builds.
vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'remote');
});

vi.mock('./MapCanvas', async () => {
  const React = await import('react');
  return {
    default: (props: { centerOn?: { lat: number; lng: number } | null }) => React.createElement('div', {
      role: 'region',
      'aria-label': 'Map',
      'data-center': JSON.stringify(props.centerOn ?? null),
    }),
  };
});

const FIELD = 'Search a place or paste a Google Maps link';
const nominatim = (query: string) => `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=sa&limit=5&accept-language=en`;
const CORNICHE_ROWS = [
  { display_name: 'Corniche, Al Khobar, Eastern Province, Saudi Arabia', lat: '26.2834', lon: '50.2105' },
  { display_name: 'Corniche Road, Dammam, Saudi Arabia', lat: '26.4207', lon: '50.0888' },
];
const fetchMock = vi.fn();

/** The answer of OpenStreetMap, as a response with its JSON. */
const answer = (rows: unknown) => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
const searchCalls = () => fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.startsWith('https://nominatim'));

/** Types into the one field. Typing a name alone sends nothing. */
function type(text: string) {
  fireEvent.change(screen.getByLabelText(FIELD), { target: { value: text } });
}
const enter = () => fireEvent.keyDown(screen.getByLabelText(FIELD), { key: 'Enter' });

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

describe('PinPicker one field (PRJ-13, fbk_017)', () => {
  it('shows one field for a name, a link or coordinates, with no Search button and no second field', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText(FIELD)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.queryByLabelText(/^Paste a Google Maps link/)).toBeNull();
    expect(screen.getByLabelText(FIELD).getAttribute('autocomplete')).toBe('off');
  });

  it('sets the pin at once from a pasted Google Maps address, and sends no search', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    type('https://www.google.com/maps/@26.2834,50.2105,17z');
    expect(onChange).toHaveBeenLastCalledWith({ lat: 26.2834, lng: 50.2105 });
    expect(searchCalls()).toEqual([]);
    const map = await screen.findByRole('region', { name: 'Map' });
    expect(map.getAttribute('data-center')).toBe(JSON.stringify({ lat: 26.2834, lng: 50.2105 }));
  });

  it('sets the pin at once from two coordinates', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    type('26.2172, 50.1971');
    expect(onChange).toHaveBeenLastCalledWith({ lat: 26.2172, lng: 50.1971 });
  });

  it('shows the result line with a link that checks the place in Google Maps, and no raw numbers', async () => {
    await renderWithRuntime(<PinPicker value={{ lat: 26.28, lng: 50.21 }} onChange={vi.fn()} />);
    expect(screen.getByText('Pinned on the map.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open in Google Maps' });
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps?q=26.28,50.21');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText('26.28, 50.21')).toBeNull();
  });
});

describe('PinPicker place search (Task 12b, PRJ-19, fbk_017)', () => {
  it('sends nothing while the person types a name', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Al Khobar Corniche');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches Saudi places when the person presses Enter', async () => {
    fetchMock.mockResolvedValue(answer(CORNICHE_ROWS));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Al Khobar Corniche');
    enter();
    await screen.findByRole('list', { name: 'Places found' });
    expect(searchCalls()).toEqual([nominatim('Al Khobar Corniche')]);
  });

  it('shows the hits, and a click on a hit moves the pin and the map, and names the place in the result line', async () => {
    fetchMock.mockResolvedValue(answer(CORNICHE_ROWS));
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    type('Al Khobar Corniche');
    enter();
    const list = await screen.findByRole('list', { name: 'Places found' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(list).getByRole('button', { name: 'Corniche, Al Khobar, Eastern Province, Saudi Arabia' }));
    expect(onChange).toHaveBeenLastCalledWith({ lat: 26.2834, lng: 50.2105 });
    const map = await screen.findByRole('region', { name: 'Map' });
    await waitFor(() => expect(map.getAttribute('data-center')).toBe(JSON.stringify({ lat: 26.2834, lng: 50.2105 })));
    expect(screen.queryByRole('list', { name: 'Places found' })).toBeNull();
  });

  it('tells the sheet the name of the place that a hit set, and drops the name when the pin moves by a paste', async () => {
    fetchMock.mockResolvedValue(answer(CORNICHE_ROWS));
    const onPlace = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} onPlace={onPlace} />);
    type('Al Khobar Corniche');
    enter();
    const list = await screen.findByRole('list', { name: 'Places found' });
    fireEvent.click(within(list).getAllByRole('button')[0]);
    expect(onPlace).toHaveBeenLastCalledWith('Corniche, Al Khobar');
    type('26.3, 50.1');
    expect(onPlace).toHaveBeenLastCalledWith(null);
  });

  it('searches again once with a shorter name when nothing is found: no district word and no city', async () => {
    fetchMock.mockImplementation(async (url: string) => answer(url === nominatim('Al Rakah district Khobar') ? [] : CORNICHE_ROWS));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Al Rakah district Khobar');
    enter();
    await screen.findByRole('list', { name: 'Places found' }, { timeout: 3000 });
    expect(searchCalls()).toEqual([nominatim('Al Rakah district Khobar'), nominatim('Al Rakah')]);
  });

  it('says what to try next when no place matches, after the second search', async () => {
    fetchMock.mockImplementation(async () => answer([]));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Rakah district');
    enter();
    expect(await screen.findByText('No place found. Try a shorter name, the name in English, or pan the map and tap the place.', {}, { timeout: 3000 })).toBeTruthy();
    expect(searchCalls()).toHaveLength(2);
  });

  it('sends one search only when the name has nothing to leave out', async () => {
    fetchMock.mockResolvedValue(answer([]));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Nowhere');
    enter();
    await screen.findByText(/No place found/);
    expect(searchCalls()).toHaveLength(1);
  });

  it('says that the search failed when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Al Khobar Corniche');
    enter();
    expect(await screen.findByText('The search failed. Try again.')).toBeTruthy();
  });

  it('sends no second request while one runs', async () => {
    let finish: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Al Khobar Corniche');
    enter();
    enter();
    expect(searchCalls()).toHaveLength(1);
    finish(answer(CORNICHE_ROWS));
    await screen.findByRole('list', { name: 'Places found' });
  });

  it('waits one second between two searches, as the OpenStreetMap policy asks', async () => {
    fetchMock.mockResolvedValue(answer(CORNICHE_ROWS));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('Al Khobar Corniche');
    enter();
    await screen.findByRole('list', { name: 'Places found' });
    enter();
    expect(searchCalls()).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    enter();
    expect(searchCalls()).toHaveLength(2);
  });
});

describe('PinPicker short link (PRJ-03)', () => {
  const SHORT = 'https://maps.app.goo.gl/AbC123';

  it('reads the short link through the server and sets the pin from the long address', async () => {
    fetchMock.mockResolvedValue(answer({ url: 'https://www.google.com/maps/place/X/@26.2834,50.2105,17z/data=!3d26.2834!4d50.2105' }));
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    type(`Villa Rakah ${SHORT}`);
    expect(screen.getByText('Madar reads the link.')).toBeTruthy();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ lat: 26.2834, lng: 50.2105 }));
    expect(fetchMock).toHaveBeenCalledWith('/maplink', expect.objectContaining({ body: JSON.stringify({ url: SHORT }) }));
    expect(screen.queryByText('Madar reads the link.')).toBeNull();
  });

  it('shows the old message and sets no pin when the server cannot read the link', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'unreachable' }));
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    type(SHORT);
    expect(await screen.findByText(/Madar cannot read this short link now/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('PinPicker swapped coordinates (PRJ-02)', () => {
  it('sets no pin outside Saudi Arabia, and offers to swap the two numbers', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    type('50.2105, 26.2834');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('This place is outside Saudi Arabia. Did you swap the two numbers?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Swap them' }));
    expect(onChange).toHaveBeenLastCalledWith({ lat: 26.2834, lng: 50.2105 });
    expect((screen.getByLabelText(FIELD) as HTMLInputElement).value).toBe('26.2834, 50.2105');
    expect(screen.queryByRole('button', { name: 'Swap them' })).toBeNull();
  });

  it('says so when the swap is outside Saudi Arabia too', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    type('60.5, 70.5');
    fireEvent.click(screen.getByRole('button', { name: 'Swap them' }));
    expect(screen.getByText('The two numbers are outside Saudi Arabia in both orders.')).toBeTruthy();
  });
});
