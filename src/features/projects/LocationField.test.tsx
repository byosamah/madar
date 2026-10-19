import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { State } from '../../api/store';
import { renderApp, renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from './NewProjectSheet';

const LOAD = { timeout: 10_000 };

// The Location of a project is the address of its pin (owner, 2026-10-19). The form has one Location field. The prototype has no
// network lookup, so a new pin comes with an empty address there.

async function openEdit(prepare?: (state: State) => void) {
  const app = await renderApp('/projects/prj_001', prepare);
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
  const field = await within(sheet).findByRole('group', { name: 'Location' });
  return { ...app, sheet, field };
}

async function pasteAndUse(text: string) {
  const pinSheet = await screen.findByRole('dialog', { name: 'Pin on the map' });
  fireEvent.change(within(pinSheet).getByLabelText(/^Paste a Google Maps link/), { target: { value: text } });
  await userEvent.click(within(pinSheet).getByRole('button', { name: 'Use this place' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pin on the map' })).toBeNull());
}

const updates = (state: State) => Object.values(state.events).filter((event) => event.verb === 'project.updated' && event.targetId === 'prj_001');

describe('the Location field in the edit form (owner, 2026-10-19)', () => {
  it('is one field: the label Location, the address of the pin, the link to check it, and no second place', async () => {
    const { sheet, field } = await openEdit();
    expect(within(sheet).getAllByText('Location')).toHaveLength(1);
    expect(sheet.querySelector('#project-location')).toBeNull();
    expect(within(sheet).queryByRole('textbox', { name: 'Location' })).toBeNull();
    expect(within(sheet).queryByText('Pin on the map')).toBeNull();
    expect(within(field).getByText('Al Khobar, Corniche')).toBeInTheDocument();
    expect(within(field).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=26.2928,50.2172');
    expect(within(field).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(within(field).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(field).queryByText(/26\.2928/)).toBeNull();
    expect(within(field).queryByText('Not saved yet')).toBeNull();
  });

  it('says Pinned on the map when the pin has no address', async () => {
    const { field } = await openEdit((state) => {
      state.projects.prj_001.location = '';
    });
    expect(within(field).getByText('Pinned on the map.')).toBeInTheDocument();
    expect(within(field).getByRole('link', { name: 'Open in Google Maps' })).toBeInTheDocument();
  });

  it('saves a new pin and its address in one write, so one Undo takes both back', async () => {
    const { sheet, field, store } = await openEdit();
    const before = updates(store.state).length;
    await userEvent.click(within(field).getByRole('button', { name: 'Change' }));
    await pasteAndUse('26.3, 50.1');
    // The old address described the old pin: the row now says that the pin has no address yet. The form still holds the change.
    expect(within(field).getByText('Pinned on the map.')).toBeInTheDocument();
    expect(within(field).queryByText('Al Khobar, Corniche')).toBeNull();
    expect(within(field).getByText('Not saved yet')).toBeInTheDocument();
    expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.3, lng: 50.1 }));
    expect(store.state.projects.prj_001.location).toBe('');
    const written = updates(store.state);
    expect(written).toHaveLength(before + 1);
    expect(written.at(-1)?.after).toMatchObject({ geo: { lat: 26.3, lng: 50.1 }, location: '' });
  });

  it('keeps the address of the pin when the person opens the pin sheet and presses Use this place with no change', async () => {
    const { sheet, field, store } = await openEdit();
    await userEvent.click(within(field).getByRole('button', { name: 'Change' }));
    const pinSheet = await screen.findByRole('dialog', { name: 'Pin on the map' });
    await userEvent.click(within(pinSheet).getByRole('button', { name: 'Use this place' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pin on the map' })).toBeNull());
    expect(within(field).getByText('Al Khobar, Corniche')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit project' })).toBeNull());
    expect(store.state.projects.prj_001.location).toBe('Al Khobar, Corniche');
  });

  it('removes the pin and the address together', async () => {
    const { sheet, field, store } = await openEdit();
    await userEvent.click(within(field).getByRole('button', { name: 'Remove' }));
    expect(within(field).getByText('No location yet')).toBeInTheDocument();
    expect(within(field).queryByRole('link', { name: 'Open in Google Maps' })).toBeNull();
    expect(within(field).getByRole('button', { name: 'Set location' })).toBeInTheDocument();
    expect(within(field).queryByRole('button', { name: 'Remove' })).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.geo).toBeNull());
    expect(store.state.projects.prj_001.location).toBe('');
  });

  it('keeps the pin and the address when the person changes only the name', async () => {
    const { sheet, store } = await openEdit();
    const name = within(sheet).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Corniche Tower Two');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.name).toBe('Corniche Tower Two'));
    expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
    expect(store.state.projects.prj_001.location).toBe('Al Khobar, Corniche');
  });

  it('shows the old typed text of a project with no pin, offers Set location, and keeps the text on a save', async () => {
    const { sheet, field, store } = await openEdit((state) => {
      state.projects.prj_001.geo = null;
      state.projects.prj_001.location = 'Dammam, King Fahd Road';
    });
    expect(within(field).getByText('Dammam, King Fahd Road')).toBeInTheDocument();
    expect(within(field).queryByRole('link', { name: 'Open in Google Maps' })).toBeNull();
    expect(within(field).getByRole('button', { name: 'Set location' })).toBeInTheDocument();
    const name = within(sheet).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.name).toBe('Renamed'));
    expect(store.state.projects.prj_001.location).toBe('Dammam, King Fahd Road');
    expect(store.state.projects.prj_001.geo).toBeNull();
  });

  it('lets the person clear the old text of a project with no pin', async () => {
    const { sheet, field, store } = await openEdit((state) => {
      state.projects.prj_001.geo = null;
      state.projects.prj_001.location = 'Dammam, King Fahd Road';
    });
    await userEvent.click(within(field).getByRole('button', { name: 'Remove' }));
    expect(within(field).getByText('No location yet')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.location).toBe(''));
  });

  it('replaces the old text with the new pin when the person sets one', async () => {
    const { sheet, field, store } = await openEdit((state) => {
      state.projects.prj_001.geo = null;
      state.projects.prj_001.location = 'Dammam, King Fahd Road';
    });
    await userEvent.click(within(field).getByRole('button', { name: 'Set location' }));
    await pasteAndUse('26.3, 50.1');
    expect(within(field).queryByText('Dammam, King Fahd Road')).toBeNull();
    expect(within(field).getByText('Pinned on the map.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.3, lng: 50.1 }));
    expect(store.state.projects.prj_001.location).toBe('');
  });

  it('shows No location yet and Set location for a project with neither', async () => {
    const { field } = await openEdit((state) => {
      state.projects.prj_001.geo = null;
      state.projects.prj_001.location = '';
    });
    expect(within(field).getByText('No location yet')).toBeInTheDocument();
    expect(within(field).getByRole('button', { name: 'Set location' })).toBeInTheDocument();
    expect(within(field).queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

describe('the Location field in the New Project form (owner, 2026-10-19)', () => {
  async function openNew() {
    const view = await renderWithRuntime(<Harness />, undefined, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    return { ...view, sheet, field: await within(sheet).findByRole('group', { name: 'Location' }) };
  }

  it('has one Location field with No location yet and a button to set it, and no text field', async () => {
    const { sheet, field } = await openNew();
    expect(within(field).getByText('No location yet')).toBeInTheDocument();
    expect(within(field).getByRole('button', { name: 'Set location' })).toBeInTheDocument();
    expect(sheet.querySelector('#project-location')).toBeNull();
    expect(within(sheet).queryByText('City and district')).toBeNull();
    expect(within(field).queryByText('Not saved yet')).toBeNull();
  });

  it('is not required', async () => {
    const { field } = await openNew();
    expect(field).not.toHaveAccessibleDescription(expect.stringMatching(/required/));
  });

  it('creates the project with the pin that the person set, and an empty address in the prototype', async () => {
    const { sheet, field, store } = await openNew();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('English name (or Arabic)'), 'Harbour Holding');
    await userEvent.type(within(sheet).getByLabelText('Initials'), 'HRB');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect(within(sheet).getByLabelText('Client initials')).toHaveValue('HRB'));
    await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'COM');
    await userEvent.type(within(sheet).getByLabelText('Building type'), 'Offices');
    await userEvent.click(within(field).getByRole('button', { name: 'Set location' }));
    await pasteAndUse('26.3, 50.1');
    expect(within(field).getByText('Pinned on the map.')).toBeInTheDocument();
    expect(within(field).queryByText('Not saved yet')).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await screen.findByText('260900HRB created.');
    const project = Object.values(store.state.projects).find((p) => p.name === 'Harbour Gate Offices');
    expect(project?.geo).toEqual({ lat: 26.3, lng: 50.1 });
    expect(project?.location).toBe('');
  });
});
