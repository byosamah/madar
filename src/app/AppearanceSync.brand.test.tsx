import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AppearanceSync } from './AppearanceSync';

const saveBrand = vi.fn(async () => undefined);
let session: Record<string, unknown> | undefined;

vi.mock('./remote/brandCache', () => ({ saveBrand: (...args: unknown[]) => saveBrand(...(args as [])) }));
vi.mock('./runtime', () => ({ useCall: () => ({ data: session }) }));
vi.mock('../features/auth/useAuth', () => ({ useAuth: () => ({ subscribe: () => () => undefined, status: () => 'signed_in' }) }));

/** The page leaves the names of the enterprise for the service worker (Madar enterprises, plan C, Task 17). */
describe('AppearanceSync and the name of the enterprise', () => {
  it('saves the two names after the session answer, and saves nothing when the session has no enterprise', async () => {
    saveBrand.mockClear();
    session = { user: { preferences: { language: 'en', theme: 'light', glass: 'frosted' } } };
    const view = render(<AppearanceSync />);
    // The writer loads on its own (a dynamic import): give it a moment before the check of the empty case.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saveBrand).not.toHaveBeenCalled();
    view.unmount();
    session = { user: { preferences: { language: 'en', theme: 'light', glass: 'frosted' } }, enterprise: { id: 'ent_002', name: 'Acme', nameAr: 'أكمي', logo: null } };
    render(<AppearanceSync />);
    await waitFor(() => expect(saveBrand).toHaveBeenCalledWith({ name: 'Acme', nameAr: 'أكمي' }));
  });
});
