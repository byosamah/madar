import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRuntime } from '../../test/render';
import { PrototypeTools } from './PrototypeTools';

describe('the prototype tools', () => {
  it('draws Preview as, Simulate errors and Reset sample data', async () => {
    await renderWithRuntime(<PrototypeTools />);
    expect(await screen.findByRole('combobox', { name: /Preview as/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Simulate errors' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset sample data' }));
    expect(await screen.findByRole('dialog', { name: 'Reset the sample data?' })).toBeInTheDocument();
  });

  it('turns Simulate errors on in the store', async () => {
    const { store } = await renderWithRuntime(<PrototypeTools />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Simulate errors' }));
    await waitFor(() => expect(store.state.session.simulateErrors).toBe(true));
  });

  it('keeps everything after Cancel in the reset question', async () => {
    await renderWithRuntime(<PrototypeTools />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset sample data' }));
    const ask = await screen.findByRole('dialog', { name: 'Reset the sample data?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reset the sample data?' })).toBeNull());
  });
});
