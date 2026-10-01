import { describe, expect, it } from 'vitest';
import { clientName } from './clientName';

describe('clientName', () => {
  it('shows the name in the screen language and falls back to the other one', () => {
    const both = { name: 'Tamr Hospitality', nameAr: 'تمر للضيافة' };
    expect(clientName(both, 'en')).toBe('Tamr Hospitality');
    expect(clientName(both, 'ar')).toBe('تمر للضيافة');
    expect(clientName({ name: 'Gulf Crest Holding' }, 'ar')).toBe('Gulf Crest Holding');
    expect(clientName({ name: '', nameAr: 'مالك الفيلا' }, 'en')).toBe('مالك الفيلا');
  });
});
