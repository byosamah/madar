import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_PREREQUISITES } from '../../../api/contract/limits';
import type { State } from '../../../api/store';
import { addOfficeTask, renderPanel, setupTask } from '../../../test/renderPanel';
import { PhoneDetails } from './PhoneDetails';
import type { TaskPanel } from './useTaskPanel';

const saved = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('../../../app/files', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../app/files')>();
  return { ...real, downloadFile: async (_api: unknown, id: string) => { saved.names.push(id); } };
});

const details = (panel: TaskPanel) => <PhoneDetails panel={panel} />;
const open = (taskId: string, prepare: (state: State) => void) => renderPanel(taskId, { phone: true, prepare, render: details });
const as = (userId: string, extra?: (state: State) => void) => (state: State) => {
  state.session.currentUserId = userId;
  extra?.(state);
};
const addFile = (state: State, id: string, name: string, mimeType: string, size: number, taskId = 'tsk_007') => {
  state.files[id] = {
    id, projectId: 'prj_001', stageId: null, taskId, name,
    versions: [{ letter: 'A', blobKey: `k-${id}`, mimeType, size, uploadedBy: 'usr_006', uploadedAt: '2026-09-29T10:00:00.000+03:00' }],
  };
};
let n = 9100;
const addEvent = (state: State, patch: Record<string, unknown> = {}) => {
  n += 1;
  state.events[`evt_${n}`] = {
    id: `evt_${n}`, seq: 90_000 + n, projectId: 'prj_001', actorId: 'usr_002', actorKind: 'human', actingForId: 'usr_002', correlationId: `cor_${n}`,
    verb: 'task.status_changed', targetType: 'task', targetId: 'tsk_007', before: { status: 'todo' }, after: { status: 'in_progress' },
    createdAt: `2026-09-2${n % 9}T09:0${n % 9}:00.000+03:00`, undoneBy: null, ...patch,
  } as State['events'][string];
};

beforeEach(() => {
  saved.names.length = 0;
});

describe('PhoneDetails, Files', () => {
  it('lists files as rows with a plain icon, the name and the size', async () => {
    const view = await open('tsk_007', as('usr_006', (state) => {
      addFile(state, 'fil_901', 'Stair site.jpg', 'image/jpeg', 1572864);
      addFile(state, 'fil_902', 'Stair notes.zip', 'application/zip', 2048);
    }));
    const group = await screen.findByRole('region', { name: 'Files · 2' });
    expect(within(group).getByRole('button', { name: /Stair site\.jpg/ })).toHaveTextContent('1.5 MB');
    expect(within(group).getByRole('button', { name: /Stair notes\.zip/ })).toHaveTextContent('2 KB');
    view.unmount();
    await open('tsk_007', as('usr_006', (state) => {
      for (const id of Object.keys(state.files)) if (state.files[id].taskId === 'tsk_007') delete state.files[id];
    }));
    expect(await screen.findByText('No files on this to-do.')).toBeInTheDocument();
  });

  it('opens the preview for a picture and saves any other file', async () => {
    await open('tsk_007', as('usr_006', (state) => {
      addFile(state, 'fil_901', 'Stair site.jpg', 'image/jpeg', 1572864);
      addFile(state, 'fil_902', 'Stair notes.zip', 'application/zip', 2048);
    }));
    await userEvent.click(await screen.findByRole('button', { name: /Stair notes\.zip/ }));
    await waitFor(() => expect(saved.names).toEqual(['fil_902']));
    expect(screen.queryByRole('dialog', { name: 'Stair notes.zip' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Stair site\.jpg/ }));
    expect(await screen.findByRole('dialog', { name: 'Stair site.jpg' })).toBeInTheDocument();
  });
});

describe('PhoneDetails, Needs first and Unlocks', () => {
  it('shows Needs first rows with status words and an X for editors, and an Add row', async () => {
    await open('tsk_007', as('usr_002'));
    const group = await screen.findByRole('region', { name: 'Needs first' });
    expect(within(group).getByText('Reflected ceiling plans')).toBeInTheDocument();
    expect(within(group).getByText('Done')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Remove Reflected ceiling plans from the list' })).toHaveClass('size-11');
    expect(await within(group).findByLabelText('Add a to-do it needs first')).toHaveAttribute('id', 'task-add-need');
  });

  // tsk_418: the maker with task.details sees the list as an editor, also with task.assign off. The lead who did not make it does not.
  it('gives the maker with task.assign off the X and the Add row, and gives the lead who did not make the to-do none', async () => {
    const roles = (state: State) => { state.settings.roles = { off: { member: ['task.assign'] } }; };
    await open('tsk_007', as('usr_005', (state) => { roles(state); state.tasks.tsk_007.createdBy = 'usr_005'; }));
    const group = await screen.findByRole('region', { name: 'Needs first' });
    expect(await within(group).findByRole('button', { name: 'Remove Reflected ceiling plans from the list' })).toBeInTheDocument();
    expect(await within(group).findByLabelText('Add a to-do it needs first')).toBeInTheDocument();
  });

  it('hides the X and the Add row from a person who did not make the to-do', async () => {
    await open('tsk_007', as('usr_005'));
    const group = await screen.findByRole('region', { name: 'Needs first' });
    await within(group).findByText('Reflected ceiling plans');
    expect(within(group).queryByRole('button', { name: 'Remove Reflected ceiling plans from the list' })).toBeNull();
    expect(within(group).queryByLabelText('Add a to-do it needs first')).toBeNull();
  });

  it('hides the Add row at MAX_PREREQUISITES', async () => {
    await open('tsk_007', as('usr_002', (state) => {
      const ids: string[] = [];
      for (let i = 0; i < MAX_PREREQUISITES; i += 1) {
        const id = `tsk_8${String(i).padStart(2, '0')}`;
        state.tasks[id] = { ...structuredClone(state.tasks.tsk_013), id, title: `Need ${i}`, prerequisiteIds: [] };
        ids.push(id);
      }
      state.tasks.tsk_007.prerequisiteIds = ids;
    }));
    const group = await screen.findByRole('region', { name: 'Needs first' });
    await within(group).findByText('Need 0');
    expect(within(group).queryByLabelText('Add a to-do it needs first')).toBeNull();
  });

  it('hides Needs first for an office to-do and for an empty read only list', async () => {
    const view = await open('tsk_900', as('usr_005', (state) => addOfficeTask(state)));
    await screen.findByRole('region', { name: 'People' });
    expect(screen.queryByRole('region', { name: 'Needs first' })).toBeNull();
    view.unmount();
    await open('tsk_011', setupTask('tsk_011', 'usr_005'));
    await screen.findByRole('region', { name: 'People' });
    expect(screen.queryByRole('region', { name: 'Needs first' })).toBeNull();
  });

  it('shows Unlocks as a read only group with its hint', async () => {
    await open('tsk_007', as('usr_002'));
    const group = await screen.findByRole('region', { name: 'Unlocks' });
    expect(within(group).getByText('Structural drawings check')).toBeInTheDocument();
    expect(within(group).getByText('Specifications draft')).toBeInTheDocument();
    expect(within(group).queryByRole('button')).toBeNull();
    expect(screen.getByText(/^These to-dos wait for this one/)).toBeInTheDocument();
  });
});

describe('PhoneDetails, Versions', () => {
  it('shows Versions from version 2 and no group before', async () => {
    const view = await open('tsk_007', as('usr_002'));
    await screen.findByRole('region', { name: 'People' });
    expect(screen.queryByRole('region', { name: 'Versions' })).toBeNull();
    view.unmount();
    await open('tsk_007', as('usr_002', (state) => {
      Object.assign(state.tasks.tsk_007, {
        version: 2,
        versions: [
          { n: 1, reason: '', openedAt: '2026-09-01T09:00:00.000+03:00', openedBy: 'usr_002', finishedAt: '2026-09-20T09:00:00.000+03:00' },
          { n: 2, reason: 'Client comments', openedAt: '2026-09-25T09:00:00.000+03:00', openedBy: 'usr_002', finishedAt: null },
        ],
      });
    }));
    const group = await screen.findByRole('region', { name: 'Versions' });
    expect(within(group).getByText('Client comments')).toBeInTheDocument();
    expect(within(group).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('PhoneDetails, History and the end buttons', () => {
  it('shows the 3 newest history rows and See all (n) shows the rest in place', async () => {
    const { store } = await open('tsk_007', as('usr_002', (state) => {
      for (let i = 0; i < 5; i += 1) addEvent(state);
    }));
    const group = await screen.findByRole('region', { name: 'History' });
    const total = Object.values(store.state.events).filter((event) => event.targetType === 'task' && event.targetId === 'tsk_007').length;
    expect(total).toBeGreaterThanOrEqual(5);
    expect(within(group).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(within(group).getByRole('button', { name: `See all (${total})` }));
    expect(within(group).getAllByRole('listitem')).toHaveLength(total);
    expect(within(group).queryByRole('button', { name: /See all/ })).toBeNull();
  });

  it('puts Undo agent change under the text of its row, 44 px, with the toast Change undone.', async () => {
    const { store } = await open('tsk_007', as('usr_002', (state) => {
      addEvent(state, { actorId: 'usr_009', actorKind: 'agent', actingForId: 'usr_002' });
    }));
    const group = await screen.findByRole('region', { name: 'History' });
    // The button shows once the session has loaded (the rule asks who the viewer is).
    const undo = await within(group).findByRole('button', { name: 'Undo agent change' });
    expect(undo).toHaveClass('min-h-11');
    expect(undo.closest('li')).not.toBeNull();
    await userEvent.click(undo);
    expect(await screen.findByText('Change undone.')).toBeInTheDocument();
    expect(Object.values(store.state.events).some((event) => event.verb === 'undo')).toBe(true);
  });

  it('shows Leave, Save as template and Delete in full width 48 px buttons by the gates of the desk', async () => {
    const view = await open('tsk_007', as('usr_002', (state) => { state.tasks.tsk_007.helperIds = ['usr_002']; }));
    const leave = await screen.findByRole('button', { name: 'Leave this to-do' });
    const template = screen.getByRole('button', { name: 'Save as template' });
    const remove = screen.getByRole('button', { name: 'Delete to-do' });
    for (const button of [leave, template, remove]) expect(button).toHaveClass('min-h-12', 'w-full');
    expect(remove).toHaveClass('text-late');
    view.unmount();
    // A reader holds none of the three.
    await open('tsk_011', setupTask('tsk_011', 'usr_005'));
    await screen.findByRole('region', { name: 'People' });
    expect(screen.queryByRole('button', { name: 'Leave this to-do' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete to-do' })).toBeNull();
  });

  it('deletes a to-do with the Undo toast and closes the panel', async () => {
    const { store, onClose } = await open('tsk_013', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete to-do' }));
    await waitFor(() => expect(store.state.tasks.tsk_013).toBeUndefined());
    expect(await screen.findByText('To-do deleted.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});
