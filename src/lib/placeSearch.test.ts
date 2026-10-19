import { describe, expect, it } from 'vitest';
import { parseResults, parseReverse, reverseUrl, searchUrl, shortName, simplerQuery } from './placeSearch';

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

describe('simplerQuery (PRJ-19)', () => {
  it('takes away the word district and the city, in Arabic', () => {
    expect(simplerQuery('حي الراكة الخبر')).toBe('الراكة');
  });

  it('takes away the word district and the city, in English', () => {
    expect(simplerQuery('Al Rakah district Khobar')).toBe('Al Rakah');
    expect(simplerQuery('Rakah dist., Al Khobar, Saudi Arabia')).toBe('Rakah');
  });

  it('gives null when nothing changes, or when nothing is left, so no second search runs', () => {
    expect(simplerQuery('Al Khobar Corniche')).toBe('Corniche');
    expect(simplerQuery('Corniche')).toBeNull();
    expect(simplerQuery('Al Khobar')).toBeNull();
    expect(simplerQuery('حي')).toBeNull();
  });
});

describe('shortName (PRJ-13)', () => {
  it('keeps the first two parts of a long place name', () => {
    expect(shortName('Corniche, Al Khobar, Eastern Province, 34429, Saudi Arabia')).toBe('Corniche, Al Khobar');
    expect(shortName('Corniche')).toBe('Corniche');
  });
});

describe('reverseUrl (the Location is the address of the pin, 2026-10-19)', () => {
  it('asks OpenStreetMap for the place of one point, at street level, in the screen language', () => {
    expect(reverseUrl({ lat: 26.2834, lng: 50.2105 }, 'en')).toBe(
      'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=26.2834&lon=50.2105&zoom=17&accept-language=en',
    );
    expect(reverseUrl({ lat: 26.2834, lng: 50.2105 }, 'ar')).toContain('&accept-language=ar');
  });

  it('writes the numbers with at most six decimals, so the address stays short', () => {
    expect(reverseUrl({ lat: 26.28340001234, lng: 50.2105 }, 'en')).toContain('lat=26.2834&lon=50.2105&');
  });
});

describe('parseReverse (the Location is the address of the pin, 2026-10-19)', () => {
  const answer = (address: Record<string, string>) => ({ display_name: 'A very long name, Eastern Province, 34429, Saudi Arabia', address });

  it('gives the road and the city: "King Fahd Road, Dammam"', () => {
    expect(parseReverse(answer({ road: 'King Fahd Road', suburb: 'Al Faisaliyah', city: 'Dammam', state: 'Eastern Province', country: 'Saudi Arabia' })))
      .toBe('King Fahd Road, Dammam');
  });

  it('takes a town or a village when the answer has no city', () => {
    expect(parseReverse(answer({ road: 'Main Road', town: 'Qatif' }))).toBe('Main Road, Qatif');
    expect(parseReverse(answer({ road: 'Farm Road', village: 'Tarut' }))).toBe('Farm Road, Tarut');
  });

  it('takes the district when the answer has a road and no city', () => {
    expect(parseReverse(answer({ road: 'Street 12', suburb: 'Al Rakah' }))).toBe('Street 12, Al Rakah');
    expect(parseReverse(answer({ road: 'Street 12', neighbourhood: 'Al Rakah' }))).toBe('Street 12, Al Rakah');
  });

  it('gives the district and the city when the answer has no road', () => {
    expect(parseReverse(answer({ suburb: 'Al Rakah', city: 'Al Khobar' }))).toBe('Al Rakah, Al Khobar');
  });

  it('gives one part when the answer has only one', () => {
    expect(parseReverse(answer({ city: 'Dammam' }))).toBe('Dammam');
    expect(parseReverse(answer({ road: 'Corniche Road' }))).toBe('Corniche Road');
  });

  it('keeps the Arabic names that OpenStreetMap gives for an Arabic screen', () => {
    expect(parseReverse(answer({ road: 'طريق الملك فهد', city: 'الدمام' }))).toBe('طريق الملك فهد, الدمام');
  });

  it('never repeats the same name twice', () => {
    expect(parseReverse(answer({ road: 'Dammam', city: 'Dammam' }))).toBe('Dammam');
  });

  it('gives an empty text when the answer holds no road, no district and no city', () => {
    expect(parseReverse(answer({ state: 'Eastern Province', country: 'Saudi Arabia', postcode: '34429' }))).toBe('');
    expect(parseReverse({ error: 'Unable to geocode' })).toBe('');
    expect(parseReverse({ address: 'not an object' })).toBe('');
    expect(parseReverse(null)).toBe('');
    expect(parseReverse([])).toBe('');
    expect(parseReverse('text')).toBe('');
  });

  it('ignores a part that is not a text or is empty', () => {
    expect(parseReverse({ address: { road: 12, city: '  ', suburb: 'Al Rakah' } })).toBe('Al Rakah');
  });

  it('cuts a very long name to the 120 characters that a Location may hold', () => {
    const long = 'x'.repeat(200);
    expect(parseReverse(answer({ road: long, city: 'Dammam' })).length).toBeLessThanOrEqual(120);
  });
});
