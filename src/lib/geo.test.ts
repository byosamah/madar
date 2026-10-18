import { describe, expect, it } from 'vitest';
import { parseMapLink } from './geo';

describe('parseMapLink (fbk_017)', () => {
  it('reads a plain pair of coordinates, latitude first', () => {
    expect(parseMapLink('26.2834, 50.2105')).toEqual({ lat: 26.2834, lng: 50.2105 });
    expect(parseMapLink('26.28,50.21')).toEqual({ lat: 26.28, lng: 50.21 });
    expect(parseMapLink('  -33.5, 151.2  ')).toEqual({ lat: -33.5, lng: 151.2 });
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
