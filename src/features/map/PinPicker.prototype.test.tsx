import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { PinPicker } from './PinPicker';

// The prototype build has no map, so it has no place search either (Task 12b, fbk_017). The flag is folded at build time.
vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'fake');
});

describe('PinPicker in the prototype build (fbk_017)', () => {
  it('shows the paste field and no place search', async () => {
    await renderWithRuntime(<PinPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Paste a Google Maps link/)).toBeTruthy();
    expect(screen.queryByLabelText('Search a place')).toBeNull();
  });
});
