import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const sign = (root: HTMLElement, state: string) => root.querySelector(`[data-sign="${state}"]`) as HTMLElement | null;
// In the sample office Gulf Crest HQ Interiors (prj_009) waits for the client since 12 days,
// and Tamr Staff Housing (prj_012) was paused by the office 45 days ago, so it is stale at the default 30 days.

describe('the pause sheet', () => {
  async function openSheet(path = '/projects/prj_001') {
    const view = await renderApp(path, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pause project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pause this project?' });
    return { ...view, sheet };
  }

  it('asks why, with Our side chosen first', async () => {
    const { sheet } = await openSheet();
    const choice = within(sheet).getByRole('radiogroup', { name: 'Why?' });
    expect(within(choice).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Our side', 'Awaiting client']);
    expect(within(choice).getByRole('radio', { name: 'Our side' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).queryByText(/The Tracker gets a line/)).toBeNull();
  });

  it('pauses on our side: the Paused sign, and nothing in the Tracker', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'The office reviews the budget.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Pause project' }));
    const banner = await screen.findByRole('region', { name: 'Paused' });
    expect(sign(document.body, 'paused')).not.toBeNull();
    expect(within(banner).getByText('The office reviews the budget.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.pause).toMatchObject({ kind: 'internal' });
    expect(Object.values(store.state.tracker ?? {}).some((e) => e.title === 'The office reviews the budget.')).toBe(false);
  });

  it('pauses for the client: the Awaiting client sign, a Tracker line, and Resume closes it', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Awaiting client' }));
    expect(within(sheet).getByText(/The Tracker gets a line that waits for the client/)).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'We wait for the signed brief.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Pause project' }));
    const banner = await screen.findByRole('region', { name: 'Awaiting client' });
    expect(within(banner).getByText('We wait for the signed brief.')).toBeInTheDocument();
    expect(sign(document.body, 'awaiting_client')).toHaveTextContent('Awaiting client');
    expect(sign(document.body, 'paused')).toBeNull();
    const entry = Object.values(store.state.tracker ?? {}).find((e) => e.title === 'We wait for the signed brief.');
    expect(entry).toMatchObject({ projectId: 'prj_001', type: 'message', direction: 'out', waiting: 'client', closedAt: null });
    // The Overview lists the open line under what the office waits for from the client.
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(await within(attention).findByText('We wait for the signed brief.')).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole('button', { name: 'Resume project' }));
    await waitFor(() => expect(store.state.projects.prj_001.status).toBe('active'));
    expect(store.state.tracker![entry!.id]).toMatchObject({ closedBy: 'usr_002' });
    expect(store.state.tracker![entry!.id].closedAt).not.toBeNull();
  });
});

describe('the signs of a paused project', () => {
  it('shows Awaiting client and Stale in the list, each with its own shape and grey words', async () => {
    await renderApp('/projects?status=on_hold');
    const gulf = (await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ })).closest('li') as HTMLElement;
    expect(sign(gulf, 'awaiting_client')).toHaveTextContent('Awaiting client');
    expect(within(gulf).queryByText('Paused')).toBeNull();
    const tamr = screen.getByRole('link', { name: /Tamr Staff Housing/ }).closest('li') as HTMLElement;
    expect(sign(tamr, 'stale')).toHaveTextContent('Stale · paused 45 days');
    // Two different pictures, not one: the shapes differ.
    expect(sign(gulf, 'awaiting_client')!.querySelector('svg')!.innerHTML).not.toBe(sign(tamr, 'stale')!.querySelector('svg')!.innerHTML);
  });

  it('shows the Stale sign in the project header, the Overview and the banner', async () => {
    await renderApp('/projects/prj_012');
    const banner = await screen.findByRole('region', { name: 'Paused' });
    expect(banner).toHaveTextContent('Stale · paused 45 days');
    // The Standing panel draws once the tasks arrive (audit 2026-10-03, PRJ-18).
    await screen.findByRole('region', { name: 'Where the project stands' });
    const stale = document.querySelectorAll('[data-sign="stale"]');
    // The header and the Overview's Standing panel each show it.
    expect(stale.length).toBeGreaterThanOrEqual(2);
    for (const item of stale) expect(item).toHaveTextContent('Stale · paused 45 days');
  });

  it('shows Awaiting client in the header, the Overview and the banner of a client pause', async () => {
    await renderApp('/projects/prj_009');
    const banner = await screen.findByRole('region', { name: 'Awaiting client' });
    expect(banner).toHaveTextContent('Waiting for the client to approve the revised fit-out brief.');
    await screen.findByRole('region', { name: 'Where the project stands' });
    expect(document.querySelectorAll('[data-sign="awaiting_client"]').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-sign="stale"]')).toBeNull();
  });

  it('turns a client pause stale at the office limit, and a short limit makes a fresh pause stale', async () => {
    await renderApp('/projects/prj_009', (state) => {
      state.settings.staleAfterDays = 7;
    });
    const banner = await screen.findByRole('region', { name: 'Awaiting client' });
    expect(banner).toHaveTextContent('Stale · paused 12 days');
    expect(document.querySelector('[data-sign="stale"]')).not.toBeNull();
    expect(document.querySelector('[data-sign="awaiting_client"]')).toBeNull();
  });

  it('shows the signs in the meeting view, and never a health sign for a paused project', async () => {
    await renderApp('/dashboard/meeting?status=on_hold');
    const list = await screen.findByRole('list', { name: 'Project timeline' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(sign(list, 'awaiting_client')).toHaveTextContent('Awaiting client');
    expect(sign(list, 'stale')).toHaveTextContent('Stale · paused 45 days');
    expect(sign(list, 'on_track')).toBeNull();
  });

  it('shows the sign on a meeting project screen', async () => {
    await renderApp('/dashboard/meeting?status=on_hold&mode=projects');
    const article = await screen.findByRole('article');
    expect(article.querySelector('[data-sign="awaiting_client"], [data-sign="stale"]')).not.toBeNull();
  });
});

describe('the Dashboard attention list', () => {
  it('lists the stale project with its sign, and opens it', async () => {
    await renderApp('/dashboard');
    const stale = await screen.findByRole('region', { name: /Stale projects/ });
    const row = within(stale).getByRole('link', { name: /Tamr Staff Housing/ });
    expect(sign(row, 'stale')).toHaveTextContent('Stale · paused 45 days');
    expect(within(stale).getByText('Paused by the office')).toBeInTheDocument();
    expect(within(stale).queryByText(/Gulf Crest/)).toBeNull();
    await userEvent.click(row);
    await waitFor(() => expect(window.location.hash).toContain('/projects/prj_012'));
  });

  it('shows the paused project that the status filter hides, and is gone when no project is stale', async () => {
    const first = await renderApp('/dashboard?status=completed');
    expect(await screen.findByRole('region', { name: /Stale projects/ })).toBeInTheDocument();
    first.unmount();
    await renderApp('/dashboard', (state) => {
      state.settings.staleAfterDays = 365;
    });
    await screen.findByRole('tab', { name: 'Projects' });
    await waitFor(() => expect(screen.getByRole('link', { name: /Active projects/ })).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: /Stale projects/ })).toBeNull();
  });

  it('follows the people filters: a team without the stale project does not list it', async () => {
    // Interiors (Reem and Lina) includes Reem, who leads Tamr Staff Housing. Technical does not.
    const first = await renderApp('/dashboard?team=tm_003');
    expect(await screen.findByRole('region', { name: /Stale projects/ })).toBeInTheDocument();
    first.unmount();
    await renderApp('/dashboard?team=tm_002');
    await screen.findByRole('link', { name: /Active projects/ });
    expect(screen.queryByRole('region', { name: /Stale projects/ })).toBeNull();
  });
});
