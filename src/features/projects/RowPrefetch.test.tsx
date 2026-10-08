import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';
import { renderRemoteApp } from '../../test/renderRemote';

const gets = (sent: { name: string; input: unknown }[]) => sent.filter((call) => call.name === 'projects.get');
const idOf = (link: HTMLElement) => /prj_\d+/.exec(link.getAttribute('href') ?? '')?.[0] ?? '';

describe('a press on a project row starts the project (performance audit 2026-10-07, FET-12 b)', () => {
  it('asks for projects.get at pointerdown, and the project page then asks for it no more', async () => {
    const { sent, store } = await renderRemoteApp('/projects');
    const link = within(await screen.findByRole('list', { name: 'Projects' })).getAllByRole('link')[0];
    const id = idOf(link);
    expect(gets(sent)).toEqual([]);
    fireEvent.pointerDown(link, { pointerType: 'mouse' });
    await waitFor(() => expect(gets(sent)).toEqual([{ name: 'projects.get', input: { id } }]));
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: store.state.projects[id].name }, { timeout: 10_000 })).toBeInTheDocument();
    expect(gets(sent)).toHaveLength(1);
  });

  it('asks for nothing at pointerdown in the prototype', async () => {
    const { api } = await renderApp('/projects');
    const link = within(await screen.findByRole('list', { name: 'Projects' })).getAllByRole('link')[0];
    const call = vi.spyOn(api, 'call');
    fireEvent.pointerDown(link, { pointerType: 'mouse' });
    await new Promise((resolve) => { window.setTimeout(resolve, 50); });
    expect(call.mock.calls.filter(([name]) => name === 'projects.get')).toEqual([]);
  });
});
