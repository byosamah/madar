import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { initI18n } from '../../i18n';
import { renderApp } from '../../test/render';
import { personOption } from './tasks/TaskHelpers';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** A failFirst rule that fails the first matching call after "arm", and records that it did. */
function trap(name: string) {
  const state = { armed: false, hit: false };
  const match = (call: string) => {
    if (!state.armed || state.hit || call !== name) return false;
    state.hit = true;
    return true;
  };
  return { state, match };
}

describe('a failed refresh keeps the screen (audit 2026-10-03, PRJ-1)', () => {
  it('keeps the task panel open with its typed text when tasks.get fails on a refresh', async () => {
    const fail = trap('tasks.get');
    const { api } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'), { failFirst: fail.match });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByLabelText('Description'), ' DRAFT TEXT');
    fail.state.armed = true;
    await api.call('tasks.update', { id: 'tsk_013', patch: { flagged: true } });
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await settle();
    const still = screen.getByRole('dialog', { name: 'Stair details' });
    expect((within(still).getByLabelText('Description') as HTMLTextAreaElement).value).toContain('DRAFT TEXT');
  });

  it('closes the task panel when the task is gone', async () => {
    const { api } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'));
    await screen.findByRole('dialog', { name: 'Stair details' });
    await api.call('tasks.delete', { id: 'tsk_007' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
  });

  it('keeps the project when projects.get fails on a refresh', async () => {
    const fail = trap('projects.get');
    const { api } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'), { failFirst: fail.match });
    await screen.findByRole('dialog', { name: 'Stair details' });
    fail.state.armed = true;
    await api.call('tasks.update', { id: 'tsk_013', patch: { flagged: true } });
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await settle();
    expect(screen.getByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
    expect(screen.queryByText('Project not found')).toBeNull();
  });

  it('says the project did not load, not that it is gone, when the first load fails', async () => {
    await renderApp('/projects/prj_001', as('usr_002'), { failFirst: 'projects.get' });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('Project not found')).toBeNull();
    expect(screen.getAllByText('The data did not load.').length).toBeGreaterThan(0);
  });

  it('still says "Project not found" for a project that does not exist', async () => {
    await renderApp('/projects/prj_999', as('usr_002'));
    expect((await screen.findAllByText('Project not found')).length).toBeGreaterThan(0);
  });

  it('shows Retry in the task panel when the task did not load', async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_007', as('usr_002'), { failFirst: 'tasks.get' });
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
  });
});


describe('a tab whose list did not load says so and offers Retry (audit 2026-10-03, PRJ-4)', () => {
  it.each([
    ['Tasks', 'tasks', 'tasks.list'],
    ['Activity', 'activity', 'updates.list'],
    ['Tracker', 'tracker', 'tracker.list'],
    ['Files', 'files', 'files.list'],
  ])('the %s tab', async (_name, tab, call) => {
    await renderApp(`/projects/prj_001?tab=${tab}`, as('usr_002'), { failFirst: call });
    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('The data did not load.')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(panel).queryByText('The data did not load.')).toBeNull());
  });

  it('the Payments panel', async () => {
    await renderApp('/projects/prj_001', as('usr_011'), { failFirst: 'payments.list' });
    const region = await screen.findByRole('region', { name: 'Payments' });
    expect(await within(region).findByText('The data did not load.')).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Retry' }));
    expect(await within(region).findByText('Concept stage fee')).toBeInTheDocument();
  });
});

describe('closing a panel (audit 2026-10-03, PRJ-9 and PRJ-10)', () => {
  it('Back after Close does not open the task panel again', async () => {
    const { router } = await renderApp('/projects/prj_001?tab=tasks', as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /^Stair details/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
    await router.navigate(-1);
    await settle();
    expect(router.state.location.search).not.toContain('task=');
    expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull();
  });

  it('Back after Close does not open the payment sheet again', async () => {
    const { router } = await renderApp('/projects/prj_001', as('usr_011'));
    const region = await screen.findByRole('region', { name: 'Payments' });
    await userEvent.click(await within(region).findByRole('button', { name: /Concept stage fee/ }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await router.navigate(-1);
    await settle();
    expect(router.state.location.search).not.toContain('payment=');
  });

  it('a task closed on the Overview forgets its Conversation, so the next task opens on Details', async () => {
    const { router } = await renderApp('/projects/prj_001', as('usr_002'));
    const people = await screen.findByRole('region', { name: 'Who is doing what' });
    const lines = await within(people).findAllByRole('button');
    await userEvent.click(lines[0]);
    const first = await screen.findByRole('dialog');
    await userEvent.click(within(first).getByRole('tab', { name: /Conversation/ }));
    await userEvent.click(within(first).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).not.toContain('thread');
    await userEvent.click((await within(screen.getByRole('region', { name: 'Who is doing what' })).findAllByRole('button'))[1]);
    const second = await screen.findByRole('dialog');
    expect(within(second).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('a failed save rolls back (audit 2026-10-03, PRJ-7)', () => {
  it('unticks a checklist box whose save failed', async () => {
    let taskId = '';
    const fail = trap('tasks.update');
    const { store } = await renderApp('/projects/prj_001?tab=tasks', (state) => {
      state.session.currentUserId = 'usr_002';
      taskId = Object.values(state.tasks).find((task) => task.projectId === 'prj_001' && task.status !== 'done' && task.checklist.some((item) => !item.done))!.id;
    }, { failFirst: fail.match });
    const task = store.state.tasks[taskId];
    const item = task.checklist.find((entry) => !entry.done)!;
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${task.title}`) }));
    const sheet = await screen.findByRole('dialog', { name: task.title });
    fail.state.armed = true;
    await userEvent.click(within(sheet).getByRole('checkbox', { name: item.text }));
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await waitFor(() => expect(within(sheet).getByRole('checkbox', { name: item.text })).not.toBeChecked());
  });

  it('puts back a task date whose save failed', async () => {
    const fail = trap('tasks.update');
    const { store } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_013', (state) => {
      state.session.currentUserId = 'usr_002';
      Object.assign(state.tasks.tsk_013, { startDate: null, dueDate: null, schedule: 'static', durationDays: null });
    }, { failFirst: fail.match });
    const sheet = await screen.findByRole('dialog', { name: store.state.tasks.tsk_013.title });
    fail.state.armed = true;
    fireEvent.change(within(sheet).getByLabelText('Start date'), { target: { value: '2026-01-05' } });
    fireEvent.blur(within(sheet).getByLabelText('Start date'));
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await waitFor(() => expect(within(sheet).getByLabelText('Start date')).toHaveValue(''));
  });

  it('puts back a stage date whose save failed', async () => {
    const fail = trap('stages.setDates');
    const { store } = await renderApp('/projects/prj_001?tab=schedule', as('usr_002'), { failFirst: fail.match });
    const stage = Object.values(store.state.stages).find((item) => item.projectId === 'prj_001' && item.startDate)!;
    const field = () => document.getElementById(`start-${stage.id}`) as HTMLInputElement;
    await waitFor(() => expect(field()).not.toBeNull());
    fail.state.armed = true;
    fireEvent.change(field(), { target: { value: '2025-01-05' } });
    fireEvent.blur(field());
    await waitFor(() => expect(fail.state.hit).toBe(true));
    await waitFor(() => expect(field()).toHaveValue(stage.startDate));
  });
});

describe('Arabic verbs agree with a woman (audit 2026-10-03, PRJ-11)', () => {
  it('says حدّدته when a woman set the health by hand', async () => {
    await renderApp('/projects/prj_001', (state) => {
      state.session.currentUserId = 'usr_002';
      state.users.usr_002.preferences.language = 'ar';
      state.projects.prj_001.healthOverride = { value: 'at_risk', reason: 'Client delay', setBy: 'usr_001', setAt: '2026-09-29T09:00:00.000+03:00' };
    });
    try {
      expect(await screen.findByText('حدّدته Hala Nasser:')).toBeInTheDocument();
    } finally {
      initI18n('en');
    }
  });

  it('says تنضم for a woman outside the team', () => {
    const i18n = initI18n('ar');
    try {
      expect(personOption({ id: 'usr_003', name: 'Reem', gender: 'female' }, false, i18n.t)).toBe('Reem (تنضم إلى الفريق)');
      expect(personOption({ id: 'usr_004', name: 'Omar', gender: 'male' }, false, i18n.t)).toBe('Omar (ينضم إلى الفريق)');
    } finally {
      initI18n('en');
    }
  });
});

describe('the payment amount (audit 2026-10-03, PRJ-12)', () => {
  it('reads Arabic-Indic digits', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_011'));
    const region = await screen.findByRole('region', { name: 'Payments' });
    await userEvent.click(within(region).getByRole('button', { name: 'Add payment' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add payment' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Tender stage fee');
    await userEvent.type(within(sheet).getByLabelText('Amount (SAR)'), '١٥٬٠٠٠٫٥');
    fireEvent.change(within(sheet).getByLabelText('Due date'), { target: { value: '2026-11-15' } });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.payments ?? {}).find((p) => p.name === 'Tender stage fee')?.amount).toBe(15000.5));
  });
});

describe('the paused banner (audit 2026-10-03, PRJ-14 and PRJ-20)', () => {
  const paused = (resumeOn: string) => (state: State) => {
    state.session.currentUserId = 'usr_002';
    Object.assign(state.projects.prj_001, {
      status: 'on_hold',
      pause: { reason: 'The office reviews the budget.', resumeOn, by: 'usr_002', at: '2026-09-20T09:00:00.000+03:00', kind: 'internal' },
    });
  };

  it('says the planned restart passed, in the Attention color', async () => {
    await renderApp('/projects/prj_001', paused('2026-09-28'));
    const banner = await screen.findByRole('region', { name: 'Paused' });
    const late = within(banner).getByText('Planned restart was 28 September 2026.');
    expect(late).toHaveClass('text-attn');
    expect(within(banner).queryByText(/^Restarts/)).toBeNull();
  });

  it('still says "Restarts" before the date', async () => {
    await renderApp('/projects/prj_001', paused('2026-10-05'));
    const banner = await screen.findByRole('region', { name: 'Paused' });
    expect(within(banner).getByText(/Restarts 5 October 2026\./)).toBeInTheDocument();
  });

  it('offers Resume once: on the banner, not in the menu', async () => {
    await renderApp('/projects/prj_001', paused('2026-10-05'));
    const banner = await screen.findByRole('region', { name: 'Paused' });
    expect(within(banner).getByRole('button', { name: 'Resume project' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Resume project' })).toBeNull();
  });
});

describe('a stage with one date (audit 2026-10-03, PRJ-23)', () => {
  const oneDate = (state: State) => {
    state.session.currentUserId = 'usr_005';
    const stages = Object.values(state.stages).filter((stage) => stage.projectId === 'prj_001').sort((a, b) => a.order - b.order);
    Object.assign(stages[stages.length - 1], { startDate: '2027-03-01', endDate: null });
    Object.assign(stages[stages.length - 2], { startDate: null, endDate: '2027-02-15' });
  };

  it('shows the one date on the Schedule, not "No dates"', async () => {
    await renderApp('/projects/prj_001?tab=schedule', oneDate);
    expect(await screen.findByText('Starts 1 Mar')).toBeInTheDocument();
    expect(screen.getByText('Ends 15 Feb')).toBeInTheDocument();
  });

  it('shows the one date in the stage list of the header', async () => {
    const { store } = await renderApp('/projects/prj_001', oneDate);
    const last = Object.values(store.state.stages).filter((stage) => stage.projectId === 'prj_001').sort((a, b) => b.order - a.order)[0];
    await userEvent.click(await screen.findByRole('button', { name: /Construction Documents/ }));
    const popover = screen.getByRole('dialog', { name: 'Stages' });
    await userEvent.click(within(popover).getByRole('button', { name: new RegExp(last.name) }));
    expect(within(popover).getByText('Starts 1 Mar')).toBeInTheDocument();
  });
});

describe('Copy for an office folder (audit 2026-10-03, PRJ-15)', () => {
  it('says so and selects the path when the browser blocks the clipboard', async () => {
    const saved = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      const { store } = await renderApp('/projects/prj_001', as('usr_002'));
      const about = await screen.findByRole('region', { name: 'About' });
      fireEvent.click(within(about).getByRole('button', { name: /^Copy / }));
      expect(await screen.findByText('Copy did not work here. The path is selected: copy it with your keyboard.')).toBeInTheDocument();
      const field = within(about).getByRole('textbox', { name: /Path/ }) as HTMLInputElement;
      expect(field.value).toBe(store.state.projects.prj_001.modelFolderPath);
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    } finally {
      if (saved) Object.defineProperty(window.navigator, 'clipboard', saved);
      else Reflect.deleteProperty(window.navigator, 'clipboard');
    }
  });

  it('says "Path copied." when the clipboard works', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const saved = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      await renderApp('/projects/prj_001', as('usr_002'));
      const about = await screen.findByRole('region', { name: 'About' });
      fireEvent.click(within(about).getByRole('button', { name: /^Copy / }));
      expect(await screen.findByText('Path copied.')).toBeInTheDocument();
      expect(writeText).toHaveBeenCalled();
    } finally {
      if (saved) Object.defineProperty(window.navigator, 'clipboard', saved);
      else Reflect.deleteProperty(window.navigator, 'clipboard');
    }
  });
});

describe('files in a post (audit 2026-10-03, PRJ-6)', () => {
  it('saves a post file from its chip, and says "File removed" after a delete, never the raw id', async () => {
    const { api } = await renderApp('/projects/prj_001?tab=activity', as('usr_002'));
    const view = await api.call('files.upload', { projectId: 'prj_001', name: 'Brief notes.txt', blob: new Blob(['hello'], { type: 'text/plain' }) });
    await api.call('updates.create', { projectId: 'prj_001', body: 'See the brief.', fileIds: [view.file.id] });
    const chip = await screen.findByRole('button', { name: 'Download Brief notes.txt' });
    const spy = vi.spyOn(api, 'call');
    await userEvent.click(chip);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('files.get', { id: view.file.id, letter: undefined }));
    spy.mockRestore();
    await api.call('files.delete', { id: view.file.id });
    const post = (await screen.findByText('See the brief.')).closest('li') as HTMLElement;
    expect(await within(post).findByText('File removed')).toBeInTheDocument();
    expect(within(post).queryByText(view.file.id)).toBeNull();
  });

  it('uses the attachments the API sends with a post', async () => {
    const { api } = await renderApp('/projects/prj_001', as('usr_002'));
    const view = await api.call('files.upload', { projectId: 'prj_001', name: 'Site photo.png', blob: new Blob(['x'], { type: 'image/png' }) });
    await api.call('updates.create', { projectId: 'prj_001', body: 'A photo from site.', fileIds: [view.file.id] });
    const original = api.call.bind(api);
    api.call = (async (name: string, input: unknown, meta?: unknown) => {
      const output = await (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
      if (name !== 'updates.list') return output;
      return (output as { kind: string; fileIds?: string[] }[]).map((item) => (item.kind === 'update'
        ? { ...item, attachments: (item.fileIds ?? []).map((id) => ({ id, name: 'Named by the API.png' })) }
        : item));
    }) as typeof api.call;
    await userEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    const post = (await screen.findByText('A photo from site.')).closest('li') as HTMLElement;
    expect(await within(post).findByRole('button', { name: 'Download Named by the API.png' })).toBeInTheDocument();
  });
});

describe('Delete in the file menu (audit 2026-10-03, PRJ-16)', () => {
  it('follows canDelete from the API when it is there', async () => {
    let fileId = '';
    const { api, store } = await renderApp('/projects/prj_001', (state) => {
      state.session.currentUserId = 'usr_005';
      const file = Object.values(state.files).find((item) => item.projectId === 'prj_001')!;
      file.versions[0].uploadedBy = 'usr_005';
      fileId = file.id;
      delete state.members['prj_001:usr_005'];
    });
    const original = api.call.bind(api);
    api.call = (async (name: string, input: unknown, meta?: unknown) => {
      const output = await (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
      return name === 'files.list' ? (output as object[]).map((view) => ({ ...view, canDelete: false })) : output;
    }) as typeof api.call;
    await userEvent.click(await screen.findByRole('tab', { name: 'Files' }));
    const name = store.state.files[fileId].name;
    await userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });
});

describe('files in the task panel (audit 2026-10-03, PRJ-24)', () => {
  it('opens a picture in the preview and saves any other file', async () => {
    const { api } = await renderApp('/projects/prj_001?tab=tasks', as('usr_002'));
    await api.call('files.upload', { projectId: 'prj_001', taskId: 'tsk_007', name: 'Stair sketch.png', blob: new Blob(['x'], { type: 'image/png' }) });
    const notes = await api.call('files.upload', { projectId: 'prj_001', taskId: 'tsk_007', name: 'Stair notes.txt', blob: new Blob(['x'], { type: 'text/plain' }) });
    await userEvent.click(await screen.findByRole('button', { name: /^Stair details/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const spy = vi.spyOn(api, 'call');
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Open Stair notes.txt' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('files.get', { id: notes.file.id, letter: undefined }));
    spy.mockRestore();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Open Stair sketch.png' }));
    expect(await screen.findByRole('dialog', { name: 'Stair sketch.png' })).toBeInTheDocument();
  });
});
