import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { PinPicker } from './PinPicker';

// The real build shows the map (a double here) and the place search. The paste field shows in both builds.
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

const CORNICHE_URL = 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Al%20Khobar%20Corniche&countrycodes=sa&limit=5&accept-language=en';
const CORNICHE_ROWS = [
  { display_name: 'Corniche, Al Khobar, Saudi Arabia', lat: '26.2834', lon: '50.2105' },
  { display_name: 'Corniche Road, Dammam, Saudi Arabia', lat: '26.4207', lon: '50.0888' },
];
const fetchMock = vi.fn();

/** The answer of OpenStreetMap, as a response with its JSON. */
const answer = (rows: unknown) => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });

/** Types a place into the search box. Typing alone sends nothing. */
function typeSearch(text: string) {
  fireEvent.change(screen.getByLabelText('Search a place'), { target: { value: text } });
}

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

describe('PinPicker place search (Task 12b, fbk_017)', () => {
  it('shows the search box and its Search button above the map', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Search a place')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('sends nothing while the person types', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    typeSearch('Al Khobar Corniche');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches Saudi places when the person presses Enter', async () => {
    fetchMock.mockResolvedValue(answer(CORNICHE_ROWS));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    typeSearch('Al Khobar Corniche');
    fireEvent.keyDown(screen.getByLabelText('Search a place'), { key: 'Enter' });
    await screen.findByRole('list', { name: 'Places found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(CORNICHE_URL);
  });

  it('searches when the person presses the Search button', async () => {
    fetchMock.mockResolvedValue(answer(CORNICHE_ROWS));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    typeSearch('Al Khobar Corniche');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('list', { name: 'Places found' });
    expect(fetchMock).toHaveBeenCalledWith(CORNICHE_URL);
  });

  it('shows the hits, and a click on a hit moves the pin and the map', async () => {
    fetchMock.mockResolvedValue(answer(CORNICHE_ROWS));
    const onChange = vi.fn();
    await renderWithRuntime(<PinPicker value={null} onChange={onChange} />);
    typeSearch('Al Khobar Corniche');
    fireEvent.keyDown(screen.getByLabelText('Search a place'), { key: 'Enter' });
    const list = await screen.findByRole('list', { name: 'Places found' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(list).getByRole('button', { name: 'Corniche, Al Khobar, Saudi Arabia' }));
    expect(onChange).toHaveBeenLastCalledWith({ lat: 26.2834, lng: 50.2105 });
    const map = await screen.findByRole('region', { name: 'Map' });
    await waitFor(() => expect(map.getAttribute('data-center')).toBe(JSON.stringify({ lat: 26.2834, lng: 50.2105 })));
  });

  it('says so when no place matches', async () => {
    fetchMock.mockResolvedValue(answer([]));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    typeSearch('Nowhere at all');
    fireEvent.keyDown(screen.getByLabelText('Search a place'), { key: 'Enter' });
    expect(await screen.findByText('No place found for this search.')).toBeTruthy();
  });

  it('says that the search failed when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    typeSearch('Al Khobar Corniche');
    fireEvent.keyDown(screen.getByLabelText('Search a place'), { key: 'Enter' });
    expect(await screen.findByText('The search failed. Try again.')).toBeTruthy();
  });

  it('disables the Search button while one request runs, and sends no second request', async () => {
    let finish: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {
      finish = resolve;
    }));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    typeSearch('Al Khobar Corniche');
    const button = screen.getByRole('button', { name: 'Search' });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText('Search a place'), { key: 'Enter' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(answer([]));
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false), { timeout: 3000 });
  });

  it('waits one second between two searches, as the OpenStreetMap policy asks', async () => {
    fetchMock.mockResolvedValue(answer([]));
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    typeSearch('Al Khobar Corniche');
    const box = screen.getByLabelText('Search a place');
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText('No place found for this search.');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search' }).hasAttribute('disabled')).toBe(false), { timeout: 3000 });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
