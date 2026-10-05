import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRuntime } from '../../../test/render';
import { OfficeSection } from './OfficeSection';

describe('the office settings without the code prefix (item 6b)', () => {
  it('has no code prefix field, because new codes come from the code parts', async () => {
    await renderWithRuntime(<OfficeSection />);
    const office = await screen.findByRole('region', { name: 'Office settings' });
    await within(office).findByLabelText('Workload limit');
    expect(within(office).queryByLabelText('Project code prefix')).toBeNull();
  });

  it('saves the other settings and keeps the stored prefix for the old automatic code', async () => {
    const { store } = await renderWithRuntime(<OfficeSection />);
    const office = await screen.findByRole('region', { name: 'Office settings' });
    const limit = await within(office).findByLabelText('Workload limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '12');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workloadLimit).toBe(12));
    expect(store.state.settings.codePrefix).toBe('KH');
  });
});
