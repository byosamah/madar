import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';
import { stubPhone } from './phoneHarness';

/** The Back rule of a chat on a phone (Direction D, lead decision 6): back to the screen that opened it, else to the Inbox. */
const rowLink = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name });
const backLink = () => screen.findByRole('link', { name: 'Back to chats' });

describe('the Back rule of a chat', () => {
  it('passes state.from when a row opens a chat', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    expect(router.state.location.state).toEqual({ from: '/inbox' });
  });

  it('goes back one step when the opener passed state.from', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.click(await backLink());
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(router.state.historyAction).toBe('POP');
  });

  it('goes to /inbox as a new step when no opener passed state', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox/cnv_001');
    await userEvent.click(await backLink());
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('does not leave the app: state.from with history index 0 goes to /inbox', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const link = await backLink();
    vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx: 0 });
    await userEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('ignores a second Back press while the first step runs', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const link = await backLink();
    const navigate = vi.spyOn(router, 'navigate');
    fireEvent.click(link);
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('leaves a Ctrl click on the link to the browser', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const link = await backLink();
    const navigate = vi.spyOn(router, 'navigate');
    const allowed = fireEvent.click(link, { ctrlKey: true });
    expect(allowed).toBe(true);
    expect(navigate).not.toHaveBeenCalledWith(-1);
  });
});
