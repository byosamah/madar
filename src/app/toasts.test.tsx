import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../api/errors';
import { Sheet } from '../components/Sheet';
import { initI18n } from '../i18n';
import { ToastProvider, useStandingNotice, useToast } from './toasts';

// The two kinds of toast that most screens show, written once (cleanup 2026-10-06): a change with Undo, and a failed call.
describe('the toast helpers', () => {
  function Buttons({ undo, retry, error }: { undo?: () => void; retry?: () => void; error?: unknown }) {
    const toast = useToast();
    return (
      <>
        <button type="button" onClick={() => toast.undo('Task deleted.', undo ?? (() => undefined))}>Delete</button>
        <button type="button" onClick={() => toast.failed(error, retry ? { retry } : undefined)}>Fail</button>
        <button type="button" onClick={() => toast.failed(error, { retry, message: 'Plan.pdf did not upload.' })}>Upload</button>
      </>
    );
  }

  it('undo shows the message with Undo, and Ctrl+Z runs it', async () => {
    initI18n('en');
    const undo = vi.fn();
    render(<ToastProvider><Buttons undo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText('Delete'));
    expect(screen.getByRole('status')).toHaveTextContent('Task deleted.');
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(undo).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
  });

  // fbk_033: Chrome sends a keydown with no key when it fills a saved password. The Ctrl+Z listener threw on it, in Settings.
  it('a keydown with no key throws nothing, and Ctrl+Z still works after it (fbk_033)', async () => {
    initI18n('en');
    const undo = vi.fn();
    render(<ToastProvider><Buttons undo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText('Delete'));
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      window.dispatchEvent(new Event('keydown'));
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
    expect(undo).not.toHaveBeenCalled();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(undo).toHaveBeenCalledOnce();
  });

  it('failed shows the text of the error as an alert, and Retry only for a call that may work again', async () => {
    initI18n('en');
    const retry = vi.fn();
    const view = render(<ToastProvider><Buttons retry={retry} error={new ApiError('failed', 'The call failed.')} /></ToastProvider>);
    await userEvent.click(screen.getByText('Fail'));
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    view.unmount();

    render(<ToastProvider><Buttons retry={retry} error={new ApiError('forbidden', 'No.')} /></ToastProvider>);
    await userEvent.click(screen.getByText('Fail'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('failed takes the text of a screen that says more, for example the name of a file', async () => {
    initI18n('en');
    render(<ToastProvider><Buttons retry={() => undefined} error={new ApiError('failed', 'The call failed.')} /></ToastProvider>);
    await userEvent.click(screen.getByText('Upload'));
    expect(screen.getByRole('alert')).toHaveTextContent('Plan.pdf did not upload.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

// The owner (2026-10-06, layout): after "Add", the toast "Task created. Open" stayed. The person opened the task from its row,
// and on a phone the toast covered the Start date field of the task sheet.
describe('toasts and an open sheet (owner, 2026-10-06, layout)', () => {
  afterEach(() => vi.restoreAllMocks());

  function phoneWidth() {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)', media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList);
  }

  function Screen() {
    const toast = useToast();
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => toast.show({ message: 'Task created.', action: { label: 'Open', run: () => setOpen(true), isUndo: false } })}>Add</button>
        <button type="button" onClick={() => toast.show({ message: 'Link copied.' })}>Copy</button>
        <button type="button" onClick={() => toast.undo('Task deleted.', () => undefined)}>Delete</button>
        <button type="button" onClick={() => setOpen(true)}>Open the task</button>
        <button
          type="button"
          onClick={() => {
            toast.show({ tone: 'error', message: 'The dates did not save.' });
            setOpen(true);
          }}
        >
          Save dates
        </button>
        <Sheet open={open} onOpenChange={setOpen} title="Renew the licence">
          <button type="button" onClick={() => toast.show({ message: 'Saved.' })}>Save</button>
        </Sheet>
      </>
    );
  }
  const lane = () => document.querySelector<HTMLElement>('[data-toasts]');

  it('closes the toasts without Undo when a sheet opens, and keeps the toast with Undo', async () => {
    initI18n('en');
    render(<ToastProvider><Screen /></ToastProvider>);
    await userEvent.click(screen.getByText('Add'));
    await userEvent.click(screen.getByText('Copy'));
    await userEvent.click(screen.getByText('Delete'));
    expect(lane()).toHaveTextContent('Task created.');
    expect(lane()).toHaveTextContent('Link copied.');
    await userEvent.click(screen.getByText('Open the task'));
    const sheet = await screen.findByRole('dialog', { name: 'Renew the licence' });
    expect(lane()).not.toHaveTextContent('Task created.');
    expect(lane()).not.toHaveTextContent('Link copied.');
    expect(within(lane()!).getByText('Task deleted.')).toBeInTheDocument();
    expect(within(lane()!).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    // A toast that a step inside the open sheet shows is new, so it stays.
    await userEvent.click(within(sheet).getByText('Save'));
    expect(lane()).toHaveTextContent('Saved.');
  });

  it('keeps a toast that came in the same step as the sheet, as when a failed Save dates opens its sheet again (audit V-14)', async () => {
    initI18n('en');
    render(<ToastProvider><Screen /></ToastProvider>);
    await userEvent.click(screen.getByText('Save dates'));
    await screen.findByRole('dialog', { name: 'Renew the licence' });
    expect(within(lane()!).getByRole('alert')).toHaveTextContent('The dates did not save.');
  });

  it('shows the toasts at the top of a phone screen while a sheet is open, above the sheet, and at the bottom again after', async () => {
    initI18n('en');
    phoneWidth();
    render(<ToastProvider><Screen /></ToastProvider>);
    const bottom = ['bottom-[calc(var(--phone-bar)+0.75rem)]', 'sm:bottom-6'];
    const top = ['max-sm:bottom-auto', 'max-sm:top-[calc(env(safe-area-inset-top)_+_0.75rem)]'];
    expect(lane()).toHaveClass(...bottom);
    expect(lane()).not.toHaveClass(...top);
    await userEvent.click(screen.getByText('Delete'));
    await userEvent.click(screen.getByText('Open the task'));
    await screen.findByRole('dialog', { name: 'Renew the licence' });
    expect(lane()).toHaveClass(...top);
    expect(within(lane()!).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(lane()).not.toHaveClass(...top));
    expect(lane()).toHaveClass(...bottom);
  });
});

// A notice that stays while a state lasts, such as "Live updates paused" (owner, 2026-10-20): it floats in the lane of the toasts,
// above them, so it never covers the header or moves the page.
describe('the standing notice', () => {
  function Notice({ text }: { text: string | null }) {
    useStandingNotice(text);
    const toast = useToast();
    return <button type="button" onClick={() => toast.show({ message: 'Saved.' })}>Save</button>;
  }

  it('shows in the toast lane above the toasts, stays past the time of a toast, and goes when the text goes', async () => {
    initI18n('en');
    const { rerender } = render(<ToastProvider><Notice text="Live updates paused. Your changes still save." /></ToastProvider>);
    const lane = document.querySelector('[data-toasts]') as HTMLElement;
    expect(within(lane).getByRole('status')).toHaveTextContent('Live updates paused. Your changes still save.');
    await userEvent.click(screen.getByText('Save'));
    expect(within(lane).getAllByRole('status').map((item) => item.textContent)).toEqual(['Live updates paused. Your changes still save.', 'Saved.']);
    rerender(<ToastProvider><Notice text={null} /></ToastProvider>);
    await waitFor(() => expect(within(lane).queryByText('Live updates paused. Your changes still save.')).toBeNull());
  });
});

// fbk_052: Ctrl+Z on an Arabic keyboard, the longer life of an Undo toast, and the text fields that keep their own undo.
describe('the Undo key and the Undo time (fbk_052)', () => {
  afterEach(() => vi.useRealTimers());

  function Screen({ undo }: { undo: () => void }) {
    const toast = useToast();
    return (
      <>
        <button type="button" onClick={() => toast.undo('Task deleted.', undo)}>Delete</button>
        <button type="button" onClick={() => toast.show({ message: 'Link copied.' })}>Copy</button>
        <input aria-label="Name" />
        <textarea aria-label="Note" />
      </>
    );
  }
  const press = (init: KeyboardEventInit, target: Element | Window = window) => fireEvent.keyDown(target, { ctrlKey: true, ...init });

  it('runs the Undo for an Arabic key on the Z key (code KeyZ)', async () => {
    initI18n('en');
    const undo = vi.fn();
    render(<ToastProvider><Screen undo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText('Delete'));
    press({ key: '\u0638', code: 'KeyZ' });
    expect(undo).toHaveBeenCalledOnce();
  });

  it('runs the Undo for Cmd+Z with the key in upper case', async () => {
    initI18n('en');
    const undo = vi.fn();
    render(<ToastProvider><Screen undo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText('Delete'));
    fireEvent.keyDown(window, { metaKey: true, key: 'Z', code: 'KeyZ' });
    expect(undo).toHaveBeenCalledOnce();
  });

  it('does not run the Undo for the W key of a French AZERTY keyboard (code KeyZ, key w)', async () => {
    initI18n('en');
    const undo = vi.fn();
    render(<ToastProvider><Screen undo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText('Delete'));
    press({ key: 'w', code: 'KeyZ' });
    press({ key: 'W', code: 'KeyZ' });
    expect(undo).not.toHaveBeenCalled();
  });

  it('does not run the Undo with Shift or Alt, or for a key with no code and no Z', async () => {
    initI18n('en');
    const undo = vi.fn();
    render(<ToastProvider><Screen undo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText('Delete'));
    press({ key: 'z', code: 'KeyZ', shiftKey: true });
    press({ key: 'z', code: 'KeyZ', altKey: true });
    press({ key: '\u0638', code: 'KeyX' });
    expect(undo).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+Z to the browser inside an input and a textarea', async () => {
    initI18n('en');
    const undo = vi.fn();
    render(<ToastProvider><Screen undo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText('Delete'));
    press({ key: 'z', code: 'KeyZ' }, screen.getByLabelText('Name'));
    press({ key: '\u0638', code: 'KeyZ' }, screen.getByLabelText('Name'));
    press({ key: 'z', code: 'KeyZ' }, screen.getByLabelText('Note'));
    expect(undo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('keeps an Undo toast for 8 seconds, and a plain toast for 5 seconds', () => {
    initI18n('en');
    vi.useFakeTimers();
    render(<ToastProvider><Screen undo={() => undefined} /></ToastProvider>);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Copy'));
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(screen.getByText('Task deleted.')).toBeInTheDocument();
    expect(screen.getByText('Link copied.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Link copied.')).toBeNull();
    expect(screen.getByText('Task deleted.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(screen.getByText('Task deleted.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.queryByText('Task deleted.')).toBeNull();
  });
});
