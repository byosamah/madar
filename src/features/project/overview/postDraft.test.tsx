import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDraftOwner } from '../../../app/drafts';
import { renderWithRuntime } from '../../../test/render';
import { clearLivePostDrafts, useHasPostDraft, usePostDraft } from './postDraft';

function Reader({ label, persist }: { label: string; persist: boolean }) {
  const [text, setText] = usePostDraft('prj_001', persist);
  return <input aria-label={label} value={text} onChange={(event) => setText(event.target.value)} />;
}

/** The readers mount after the session is known, so the draft key holds the person from the first keystroke. */
function Gate({ persist = true }: { persist?: boolean }) {
  const owner = useDraftOwner();
  const [show, setShow] = useState(true);
  if (!owner) return null;
  return (
    <>
      <button type="button" onClick={() => setShow((value) => !value)}>Toggle</button>
      {show && <><Reader label="A" persist={persist} /><Reader label="B" persist={persist} /></>}
    </>
  );
}

function Watcher({ onRender }: { onRender: () => void }) {
  const has = useHasPostDraft('prj_001');
  onRender();
  return <p>{has ? 'has text' : 'is empty'}</p>;
}

function WatchGate({ onRender }: { onRender: () => void }) {
  const owner = useDraftOwner();
  if (!owner) return null;
  return <><Reader label="A" persist /><Watcher onRender={onRender} /></>;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLivePostDrafts();
  window.localStorage.clear();
});

describe('the draft of the project update box (phone D, P4)', () => {
  it('shares the text between two readers of the same project, at once', async () => {
    await renderWithRuntime(<Gate />);
    await userEvent.type(await screen.findByLabelText('A'), 'Hello');
    expect(screen.getByLabelText('B')).toHaveValue('Hello');
  });

  it('gives the text back after a remount, from the draft store', async () => {
    await renderWithRuntime(<Gate />);
    await userEvent.type(await screen.findByLabelText('A'), 'Kept');
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.queryByLabelText('A')).toBeNull();
    clearLivePostDrafts();
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    await waitFor(() => expect(screen.getByLabelText('A')).toHaveValue('Kept'));
  });

  it('works when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await renderWithRuntime(<Gate />);
    await userEvent.type(await screen.findByLabelText('A'), 'Still here');
    expect(screen.getByLabelText('A')).toHaveValue('Still here');
    expect(screen.getByLabelText('B')).toHaveValue('Still here');
  });

  it('keeps the box of a desk apart (persist false)', async () => {
    await renderWithRuntime(<Gate persist={false} />);
    await userEvent.type(await screen.findByLabelText('A'), 'Mine');
    expect(screen.getByLabelText('B')).toHaveValue('');
  });

  it('tells only whether the box holds text, so a key renders its reader at most once', async () => {
    const onRender = vi.fn();
    await renderWithRuntime(<WatchGate onRender={onRender} />);
    const box = await screen.findByLabelText('A');
    expect(screen.getByText('is empty')).toBeInTheDocument();
    await userEvent.type(box, 'a');
    expect(await screen.findByText('has text')).toBeInTheDocument();
    const rendered = onRender.mock.calls.length;
    await userEvent.type(box, 'bcd');
    expect(onRender).toHaveBeenCalledTimes(rendered);
    await userEvent.clear(box);
    expect(await screen.findByText('is empty')).toBeInTheDocument();
    await userEvent.type(box, '   ');
    expect(screen.getByText('is empty')).toBeInTheDocument();
  });
});
