import { describe, expect, it } from 'vitest';
import { applyAppearance, readEnvironment, resolveAppearance } from './appearance';

const calm = { prefersDark: false, reduceTransparency: false, moreContrast: false };

describe('appearance', () => {
  it('follows the device when the theme is System', () => {
    expect(resolveAppearance({ theme: 'system', glass: 'frosted' }, { ...calm, prefersDark: true })).toEqual({ theme: 'dark', glass: 'frosted', contrast: 'normal' });
    expect(resolveAppearance({ theme: 'system', glass: 'frosted' }, calm).theme).toBe('light');
  });

  it('uses the chosen theme over the device', () => {
    expect(resolveAppearance({ theme: 'light', glass: 'clear' }, { ...calm, prefersDark: true }).theme).toBe('light');
  });

  it('makes the glass solid when the device reduces transparency', () => {
    expect(resolveAppearance({ theme: 'light', glass: 'clear' }, { ...calm, reduceTransparency: true }).glass).toBe('solid');
  });

  it('marks more contrast', () => {
    expect(resolveAppearance({ theme: 'light', glass: 'frosted' }, { ...calm, moreContrast: true }).contrast).toBe('more');
  });

  it('writes the attributes on the root element', () => {
    applyAppearance(document.documentElement, { theme: 'dark', glass: 'solid', contrast: 'more' });
    expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', glass: 'solid', contrast: 'more' });
  });

  it('reads the device settings from media queries', () => {
    const fake = { matchMedia: (query: string) => ({ matches: query.includes('dark') }) } as unknown as Window;
    expect(readEnvironment(fake)).toEqual({ prefersDark: true, reduceTransparency: false, moreContrast: false });
  });
});
