import { describe, expect, it } from 'vitest';
import { googleMapsUrl, inSaudi, parseMapLink, parseMapPoint, pinFromLinks, pointText, swapPoint } from './geo';

describe('parseMapLink (fbk_017)', () => {
  it('reads a plain pair of coordinates, latitude first', () => {
    expect(parseMapLink('26.2834, 50.2105')).toEqual({ lat: 26.2834, lng: 50.2105 });
    expect(parseMapLink('26.28,50.21')).toEqual({ lat: 26.28, lng: 50.21 });
    expect(parseMapLink('  24.7, 46.7  ')).toEqual({ lat: 24.7, lng: 46.7 });
  });

  it('reads the Arabic comma and the Arabic-Indic digits of an Arabic keyboard', () => {
    expect(parseMapLink('٢٦.٢٨، ٥٠.٢١')).toEqual({ lat: 26.28, lng: 50.21 });
  });

  it('reads the @latitude,longitude form of a Google Maps address', () => {
    expect(parseMapLink('https://www.google.com/maps/@26.2834,50.2105,17z')).toEqual({ lat: 26.2834, lng: 50.2105 });
  });

  it('reads the q= and ll= forms of a Google Maps address', () => {
    expect(parseMapLink('https://maps.google.com/?q=26.28,50.21')).toEqual({ lat: 26.28, lng: 50.21 });
    expect(parseMapLink('https://maps.google.com/?ll=26.28,50.21&z=12')).toEqual({ lat: 26.28, lng: 50.21 });
  });

  it('reads the !3d and !4d form, which wins over the @ form of the same address', () => {
    expect(parseMapLink('https://www.google.com/maps/place/Corniche/@26.1,50.1,17z/data=!3d26.2834!4d50.2105!16s')).toEqual({ lat: 26.2834, lng: 50.2105 });
  });

  it('gives short_link for a short Google Maps link, which holds no coordinates', () => {
    expect(parseMapLink('https://maps.app.goo.gl/AbC123')).toBe('short_link');
    expect(parseMapLink('https://goo.gl/maps/AbC123')).toBe('short_link');
  });

  it('gives null for text with no coordinates, a place name, or a value out of range', () => {
    expect(parseMapLink('')).toBeNull();
    expect(parseMapLink('Al Khobar Corniche')).toBeNull();
    expect(parseMapLink('https://maps.google.com/?q=Al+Khobar')).toBeNull();
    expect(parseMapLink('91, 50')).toBeNull();
    expect(parseMapLink('26, 181')).toBeNull();
  });
});

describe('the Saudi area check (PRJ-02)', () => {
  it('gives outside for a pair that sits outside Saudi Arabia, such as a swapped pair', () => {
    expect(parseMapLink('50.21, 26.28')).toBe('outside');
    expect(parseMapLink('-33.5, 151.2')).toBe('outside');
    expect(parseMapLink('https://maps.google.com/?q=50.21,26.28')).toBe('outside');
  });

  it('keeps the raw pair for the swap, with no area check', () => {
    expect(parseMapPoint('50.21, 26.28')).toEqual({ lat: 50.21, lng: 26.28 });
    expect(parseMapPoint('https://maps.app.goo.gl/AbC123')).toBe('short_link');
    expect(parseMapPoint('91, 50')).toBeNull();
  });

  it('tests a point against the box of Saudi Arabia, edges included', () => {
    expect(inSaudi({ lat: 26.28, lng: 50.21 })).toBe(true);
    expect(inSaudi({ lat: 16, lng: 34 })).toBe(true);
    expect(inSaudi({ lat: 33, lng: 56 })).toBe(true);
    expect(inSaudi({ lat: 15.9, lng: 50 })).toBe(false);
    expect(inSaudi({ lat: 26, lng: 56.1 })).toBe(false);
  });

  it('swaps latitude and longitude', () => {
    expect(swapPoint({ lat: 50.21, lng: 26.28 })).toEqual({ lat: 26.28, lng: 50.21 });
  });
});

describe('pointText and googleMapsUrl (PRJ-02, PRJ-04)', () => {
  it('writes a point with a Latin comma and at most six decimals, in both languages', () => {
    expect(pointText({ lat: 26.217200001, lng: 50.1971 })).toBe('26.2172, 50.1971');
  });

  it('builds the Google Maps address that gives directions to a pin', () => {
    expect(googleMapsUrl({ lat: 26.2172, lng: 50.1971 })).toBe('https://www.google.com/maps?q=26.2172,50.1971');
  });
});

describe('pinFromLinks (PRJ-04)', () => {
  it('gives the point of the first location link that holds coordinates inside Saudi Arabia', () => {
    expect(pinFromLinks([
      { kind: 'moodboard', url: 'https://pinterest.com/x?q=26.9,50.9' },
      { kind: 'location', url: 'https://maps.app.goo.gl/AbC123' },
      { kind: 'location', url: 'https://maps.google.com/?q=50.2,26.3' },
      { kind: 'location', url: 'https://maps.google.com/?q=26.2928,50.2172' },
    ])).toEqual({ lat: 26.2928, lng: 50.2172 });
  });

  it('gives null with no links, or with no usable location link', () => {
    expect(pinFromLinks(undefined)).toBeNull();
    expect(pinFromLinks([])).toBeNull();
    expect(pinFromLinks([{ kind: 'location', url: 'https://maps.google.com/?q=Al+Khobar' }])).toBeNull();
  });
});
