import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { initI18n } from '../../../i18n';
import { renderWithRuntime } from '../../../test/render';
import { ClientsSection } from './ClientsSection';

/** The sample office has 6 clients. Gulf Crest Holding gets initials here; the others have none yet. */
function initials(state: State) {
  state.clients.cli_001.initials = 'GCH';
}

async function open(prepare: (state: State) => void = initials) {
  const view = await renderWithRuntime(<ClientsSection />, prepare, { path: '/' });
  const section = await screen.findByRole('region', { name: 'Clients' });
  await within(section).findByText('Gulf Crest Holding');
  return { ...view, section };
}

const row = (section: HTMLElement, name: string) => within(section).getByRole('button', { name: new RegExp(name) });

describe('the Admin Clients section (item 3)', () => {
  it('shows one row per client: the name, the initials and the number of projects', async () => {
    const { section } = await open();
    expect(within(section).getAllByRole('listitem')).toHaveLength(6);
    const gulf = row(section, 'Gulf Crest Holding');
    expect(within(gulf).getByText('GCH')).toBeInTheDocument();
    expect(within(gulf).getByText('2 projects')).toBeInTheDocument();
    expect(within(row(section, 'Dune Line Developments')).getByText('3 projects')).toBeInTheDocument();
    expect(within(row(section, 'Al Waha Healthcare')).getByText('1 project')).toBeInTheDocument();
    expect(within(row(section, 'Dune Line Developments')).getByText('No initials')).toBeInTheDocument();
  });

  it('shows the names in Arabic on an Arabic screen', async () => {
    const view = await renderWithRuntime(<ClientsSection />, initials, { path: '/' });
    initI18n('ar');
    expect(await screen.findByText('شركة قمة الخليج القابضة')).toBeInTheDocument();
    expect(screen.getAllByText('مشروعان').length).toBeGreaterThan(0);
    expect(screen.getByText('مشروع واحد')).toBeInTheDocument();
    initI18n('en');
    view.unmount();
  });

  it('finds a client by its name or its initials, and says when nothing matches', async () => {
    const { section } = await open();
    const search = within(section).getByLabelText('Search clients');
    await userEvent.type(search, 'tamr');
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
    expect(within(section).getByText('Tamr Hospitality')).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'gch');
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.clear(search);
    await userEvent.type(search, 'nobody here');
    expect(within(section).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(section).getByText('No client matches this search.')).toBeInTheDocument();
  });

  it('opens a sheet with the client form and the client\'s projects as links', async () => {
    const { section } = await open();
    await userEvent.click(row(section, 'Gulf Crest Holding'));
    const sheet = await screen.findByRole('dialog', { name: 'Gulf Crest Holding' });
    expect(within(sheet).getByLabelText('English name (or Arabic)')).toHaveValue('Gulf Crest Holding');
    expect(within(sheet).getByLabelText('Initials')).toHaveValue('GCH');
    const projects = within(sheet).getByRole('list', { name: 'Projects' });
    expect(within(projects).getByRole('link', { name: /Corniche Office Tower/ })).toHaveAttribute('href', '/projects/prj_001');
    expect(within(projects).getAllByRole('link')).toHaveLength(2);
  });

  it('saves a change of the client', async () => {
    const { section, store } = await open();
    await userEvent.click(row(section, 'Dune Line Developments'));
    const sheet = await screen.findByRole('dialog', { name: 'Dune Line Developments' });
    await userEvent.type(within(sheet).getByLabelText('Initials'), 'dld');
    await userEvent.clear(within(sheet).getByLabelText('Phone'));
    await userEvent.type(within(sheet).getByLabelText('Phone'), '+966 13 000 0000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.clients.cli_002).toMatchObject({ initials: 'DLD', phone: '+966 13 000 0000' }));
    expect(await screen.findByText('Client saved.')).toBeInTheDocument();
    expect(within(row(section, 'Dune Line Developments')).getByText('DLD')).toBeInTheDocument();
  });

  it('lets an old client without initials save other fields', async () => {
    const { section, store } = await open();
    await userEvent.click(row(section, 'Tamr Hospitality'));
    const sheet = await screen.findByRole('dialog', { name: 'Tamr Hospitality' });
    await userEvent.clear(within(sheet).getByLabelText('Contact name'));
    await userEvent.type(within(sheet).getByLabelText('Contact name'), 'Bader');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.clients.cli_005.contactName).toBe('Bader'));
    expect(store.state.clients.cli_005.initials).toBeUndefined();
  });

  it('shows the messages and saves nothing when a rule fails', async () => {
    const { section, store } = await open();
    await userEvent.click(row(section, 'Gulf Crest Holding'));
    const sheet = await screen.findByRole('dialog', { name: 'Gulf Crest Holding' });
    await userEvent.clear(within(sheet).getByLabelText('English name (or Arabic)'));
    await userEvent.clear(within(sheet).getByLabelText('Arabic name (or English)'));
    await userEvent.clear(within(sheet).getByLabelText('Initials'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(within(sheet).getByText('Write the client name in English or in Arabic.')).toBeInTheDocument();
    expect(within(sheet).getByText('Use 3 or 4 capital Latin letters.')).toBeInTheDocument();
    expect(store.state.clients.cli_001.name).toBe('Gulf Crest Holding');
  });

  it('warns when another client has the same initials, and still saves', async () => {
    const { section, store } = await open();
    await userEvent.click(row(section, 'Dune Line Developments'));
    const sheet = await screen.findByRole('dialog', { name: 'Dune Line Developments' });
    await userEvent.type(within(sheet).getByLabelText('Initials'), 'GCH');
    expect(within(sheet).getByRole('status')).toHaveTextContent('Gulf Crest Holding has these initials too.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.clients.cli_002.initials).toBe('GCH'));
  });

  it('shows nothing to a person who is not the Admin', async () => {
    await renderWithRuntime(<ClientsSection />, (state) => {
      state.session.currentUserId = 'usr_010';
    }, { path: '/' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('region', { name: 'Clients' })).toBeNull();
  });
});
