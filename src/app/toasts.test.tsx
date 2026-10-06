import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../api/errors';
import { initI18n } from '../i18n';
import { ToastProvider, useToast } from './toasts';

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
