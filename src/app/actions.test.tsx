import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/errors';
import { renderWithRuntime } from '../test/render';
import { useUndoable } from './actions';
import { useAction, useRuntime } from './runtime';
import { usePersistentChoice } from './choices';
import { useFileUrl } from './files';

function Tick() {
  const complete = useUndoable('tasks.complete', { message: () => 'Task done.' });
  return <button type="button" onClick={() => complete.mutate({ id: 'tsk_013' })}>Tick</button>;
}
const asFaisal = (state: { session: { currentUserId: string } }) => {
  state.session.currentUserId = 'usr_002';
};

describe('undo toasts', () => {
  it('undoes the whole action from the toast', async () => {
    const { store } = await renderWithRuntime(<Tick />, asFaisal);
    await userEvent.click(screen.getByText('Tick'));
    expect(await screen.findByText('Task done.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013.status).toBe('done');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_013.status).toBe('todo'));
  });

  it('says so when the item changed after the action, and changes nothing', async () => {
    const { store, api } = await renderWithRuntime(<Tick />, asFaisal);
    await userEvent.click(screen.getByText('Tick'));
    await screen.findByText('Task done.');
    await api.call('tasks.move', { id: 'tsk_013', status: 'in_progress' });
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('This item changed after that edit. Undo is not available.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013.status).toBe('in_progress');
  });

  it('offers Retry when a call fails', async () => {
    let calls = 0;
    const { store } = await renderWithRuntime(<Tick />, asFaisal, { failureRate: () => (calls++ === 0 ? 1 : 0) });
    await userEvent.click(screen.getByText('Tick'));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Task done.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013.status).toBe('done');
  });
});

describe('Retry keeps the steps of the call (audit 2026-10-03, SHL-10)', () => {
  function Both() {
    const [done, setDone] = useState<string[]>([]);
    const complete = useUndoable('tasks.complete', { message: () => 'Task done.' });
    const move = useAction('tasks.move');
    return (
      <>
        <button type="button" onClick={() => complete.mutate({ id: 'tsk_013' }, { onSuccess: () => setDone((all) => [...all, 'tick']) })}>Tick</button>
        <button type="button" onClick={() => move.mutate({ id: 'tsk_012', status: 'in_progress' }, { onSuccess: () => setDone((all) => [...all, 'move']) })}>Move</button>
        <p>Done: {done.join(', ')}</p>
      </>
    );
  }

  it('runs the per-call success step after a Retry, for an undoable change and a plain one', async () => {
    // Call 0 is the first tick and call 3 the first move; the undoable tick also reads its changes (call 2).
    let calls = 0;
    const fail = new Set([0, 3]);
    await renderWithRuntime(<Both />, asFaisal, { failureRate: () => (fail.has(calls++) ? 1 : 0) });
    await userEvent.click(screen.getByText('Tick'));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Done: tick')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Move'));
    const retries = await screen.findAllByRole('button', { name: 'Retry' });
    await userEvent.click(retries.at(-1)!);
    expect(await screen.findByText('Done: tick, move')).toBeInTheDocument();
  });
});

describe('stored choices', () => {
  function Choice() {
    const [view, setView] = usePersistentChoice('madar.test.view', ['grid', 'list'] as const, 'grid');
    return <button type="button" onClick={() => setView('list')}>{view}</button>;
  }

  it('keeps a choice for the next visit and ignores a stored value it does not know', async () => {
    const first = await renderWithRuntime(<Choice />);
    await userEvent.click(screen.getByText('grid'));
    expect(screen.getByText('list')).toBeInTheDocument();
    first.unmount();
    await renderWithRuntime(<Choice />);
    expect(screen.getByText('list')).toBeInTheDocument();
    window.localStorage.setItem('madar.test.view', 'cards');
    await renderWithRuntime(<Choice />);
    expect(screen.getAllByText('grid').length).toBeGreaterThan(0);
  });
});

describe('file URLs', () => {
  function UploadThenPreview() {
    const { api } = useRuntime();
    const [fileId, setFileId] = useState<string | null>(null);
    useEffect(() => {
      void api.call('files.upload', { projectId: 'prj_001', name: 'Note.png', blob: new Blob(['x'], { type: 'image/png' }) })
        .then((view) => setFileId(view.file.id));
    }, [api]);
    const url = useFileUrl(fileId, 'A');
    return url ? <img src={url} alt="Preview" /> : <span>Loading</span>;
  }

  it('gives a blob URL for a stored file', async () => {
    await renderWithRuntime(<UploadThenPreview />, asFaisal);
    expect(await screen.findByRole('img', { name: 'Preview' })).toHaveAttribute('src', 'blob:madar-test');
  });
});

describe('actions that change nothing', () => {
  function Stay() {
    const move = useUndoable('tasks.move', { message: () => 'Moved.' });
    return <button type="button" onClick={() => move.mutate({ id: 'tsk_013', status: 'todo' })}>Stay</button>;
  }

  it('shows no toast and no Undo', async () => {
    await renderWithRuntime(<Stay />, asFaisal);
    await userEvent.click(screen.getByText('Stay'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText('Moved.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('a change whose follow-up check fails', () => {
  it('still offers Undo and reports no failure', async () => {
    const { store, api } = await renderWithRuntime(<Tick />, asFaisal);
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: { correlationId?: string }) => {
      if (name === 'events.list' && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await userEvent.click(screen.getByText('Tick'));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull();
    await waitFor(() => expect(store.state.tasks.tsk_013.status).toBe('todo'));
  });
});
