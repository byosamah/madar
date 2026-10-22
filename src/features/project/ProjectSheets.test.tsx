import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, onTestFinished } from 'vitest';
import { rememberProjectsList } from '../../app/lastList';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('the sheets of the project header (phone D, P3)', () => {
  it('opens the stage list as a sheet on a phone', async () => {
    phoneMedia(true);
    await renderApp('/projects/prj_001', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Stages' });
    expect(sheet.querySelector('[data-sheet-title]')).not.toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: /Permits/ }));
    expect(await within(sheet).findByText('To-dos done: 0 of 2')).toBeInTheDocument();
  });

  it('keeps the popover on a desk', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
    expect((await screen.findByRole('dialog', { name: 'Stages' })).querySelector('[data-sheet-title]')).toBeNull();
  });

  it('sets the health in a sheet on a phone', async () => {
    phoneMedia(true);
    await renderApp('/projects/prj_001', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Late/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Set health' });
    expect(sheet.querySelector('[data-sheet-title]')).not.toBeNull();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'At risk' }));
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'Client delay');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Set health' }));
    expect(await screen.findByText('Set by Faisal Al-Harbi')).toBeInTheDocument();
  });

  it('opens More actions as a sheet of rows, not a menu, with the same items', async () => {
    phoneMedia(true);
    await renderApp('/projects/prj_001', as('usr_001'));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    for (const label of ['Edit project', 'Change leader', 'Pause project', 'Delete project']) expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('goes to the remembered Projects list after a delete on a phone', async () => {
    phoneMedia(true);
    rememberProjectsList('?filter=at_risk');
    onTestFinished(() => rememberProjectsList(''));
    await renderApp('/projects/prj_001');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByText('Delete project'));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete Corniche Office Tower?' })).getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects?filter=at_risk'));
  });

  it('goes to /projects after a delete on a desk, whatever the remembered list holds', async () => {
    rememberProjectsList('?filter=at_risk');
    onTestFinished(() => rememberProjectsList(''));
    await renderApp('/projects/prj_001');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByText('Delete project'));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete Corniche Office Tower?' })).getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects'));
  });

  it('keeps the open stage sheet usable when the phone turns sideways (640 px and wider)', async () => {
    const view = phoneMedia(true);
    await renderApp('/projects/prj_001', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
    await screen.findByRole('dialog', { name: 'Stages' });
    act(() => view.set(false));
    const popover = await screen.findByRole('dialog', { name: 'Stages' });
    expect(popover.querySelector('[data-sheet-title]')).toBeNull();
  });
});
