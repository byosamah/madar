import { describe, expect, it } from 'vitest';
import { parseResults, searchUrl } from './placeSearch';

describe('searchUrl (Task 12b, fbk_017)', () => {
  it('asks OpenStreetMap for Saudi places, five at most, with names in the screen language', () => {
    expect(searchUrl('Al Khobar Corniche', 'en')).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Al%20Khobar%20Corniche&countrycodes=sa&limit=5&accept-language=en',
    );
  });

  it('gives the names in Arabic when the screens are in Arabic', () => {
    expect(searchUrl('الخبر', 'ar')).toContain('&accept-language=ar');
  });

  it('encodes the query, so a & or a ? stays part of the query', () => {
    const url = new URL(searchUrl('Khobar & Dammam?', 'en'));
    expect(url.searchParams.get('q')).toBe('Khobar & Dammam?');
    expect(url.origin).toBe('https://nominatim.openstreetmap.org');
  });
});

describe('parseResults (Task 12b, fbk_017)', () => {
  it('reads the name and the point of each row, when the numbers come as text', () => {
    expect(parseResults([{ display_name: 'Corniche, Al Khobar', lat: '26.2834', lon: '50.2105' }]))
      .toEqual([{ name: 'Corniche, Al Khobar', lat: 26.2834, lng: 50.2105 }]);
  });

  it('drops a row with a bad number and keeps the other rows', () => {
    const rows = [
      { display_name: 'Text, not a number', lat: 'north', lon: '50.2' },
      { display_name: 'Empty number', lat: '', lon: '50.2' },
      { display_name: 'Out of range', lat: '95', lon: '50.2' },
      { display_name: 'Good place', lat: '26.3', lon: '50.1' },
    ];
    expect(parseResults(rows)).toEqual([{ name: 'Good place', lat: 26.3, lng: 50.1 }]);
  });

  it('drops a row with no name', () => {
    expect(parseResults([{ lat: '26.3', lon: '50.1' }])).toEqual([]);
  });

  it('gives no hits for an answer that is not a list, and skips a row that is not an object', () => {
    expect(parseResults({ error: 'rate limit' })).toEqual([]);
    expect(parseResults(null)).toEqual([]);
    expect(parseResults([null, 'text', { display_name: 'Good place', lat: '26.3', lon: '50.1' }]))
      .toEqual([{ name: 'Good place', lat: 26.3, lng: 50.1 }]);
  });

  it('keeps at most five hits', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({ display_name: `Place ${index}`, lat: '26.3', lon: '50.1' }));
    expect(parseResults(rows)).toHaveLength(5);
  });
});
