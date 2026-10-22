import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { addOfficeTask, renderPanel, setupTask } from '../../../test/renderPanel';
import { PhoneHeader, TitleBlock } from './PhoneTop';
import type { TaskPanel } from './useTaskPanel';

const header = (panel: TaskPanel) => <PhoneHeader data={panel.data} />;
const title = (panel: TaskPanel) => <TitleBlock panel={panel} />;
const officeTask = (state: State) => {
  state.session.currentUserId = 'usr_005';
  addOfficeTask(state);
};

describe('PhoneHeader', () => {
  it('shows the project link, or the word Office with no link', async () => {
    const view = await renderPanel('tsk_007', { phone: true, prepare: setupTask('tsk_007', 'usr_002'), render: header });
    const link = await screen.findByRole('link', { name: 'Corniche Office Tower' });
    expect(link.getAttribute('href')).toMatch(/\/projects\/prj_001$/);
    view.unmount();
    await renderPanel('tsk_900', { phone: true, prepare: officeTask, render: header });
    expect(await screen.findByText('Office')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('TitleBlock', () => {
  it('lets an editor tap the title, type, and save on blur', async () => {
    const { store } = await renderPanel('tsk_007', { phone: true, prepare: setupTask('tsk_007', 'usr_002'), render: title });
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    expect(field).toHaveFocus();
    await userEvent.clear(field);
    await userEvent.type(field, 'Stair and ramp details');
    await userEvent.tab();
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair and ramp details'));
  });

  it('saves on Enter and puts the old title back on Escape', async () => {
    const { store } = await renderPanel('tsk_007', { phone: true, prepare: setupTask('tsk_007', 'usr_002'), render: title });
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' II{Escape}');
    expect(await screen.findByRole('button', { name: /Stair details/ })).toBeInTheDocument();
    expect(store.state.tasks.tsk_007.title).toBe('Stair details');
    await userEvent.click(screen.getByRole('button', { name: /Stair details/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' III{Enter}');
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair details III'));
  });

  it('does not save an empty title', async () => {
    const { store } = await renderPanel('tsk_007', { phone: true, prepare: setupTask('tsk_007', 'usr_002'), render: title });
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    await userEvent.tab();
    expect(await screen.findByRole('button', { name: /Stair details/ })).toBeInTheDocument();
    expect(store.state.tasks.tsk_007.title).toBe('Stair details');
  });

  it('shows plain text to a reader', async () => {
    await renderPanel('tsk_011', { phone: true, prepare: setupTask('tsk_011', 'usr_005'), render: title });
    expect(await screen.findByText('Balady submission set')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the longest title (120 characters, no space) in one wrapped block and cuts the project name', async () => {
    const long = 'A'.repeat(120); // the title limit is 120 characters (titleMax)
    const view = await renderPanel('tsk_007', { phone: true, prepare: setupTask('tsk_007', 'usr_002', { title: long }), render: title });
    expect(await screen.findByRole('button', { name: new RegExp(long) })).toHaveClass('break-words');
    view.unmount();
    await renderPanel('tsk_007', { phone: true, prepare: setupTask('tsk_007', 'usr_002'), render: header });
    expect((await screen.findByRole('link', { name: 'Corniche Office Tower' })).querySelector('bdi')).toHaveClass('truncate');
  });

  it('saves a typed title when the panel closes by a tap outside', async () => {
    const { store, unmount } = await renderPanel('tsk_007', { phone: true, prepare: setupTask('tsk_007', 'usr_002'), render: title });
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Typed at close');
    unmount();
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Typed at close'));
  });
});
