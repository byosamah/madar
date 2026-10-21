import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRuntime } from '../../test/render';
import { Composer } from './Composer';

/** onTextChange of the message box (chat presence design B1, base B6): the one function for the typing line and the emoji panel. */
const box = () => <Composer id="cnv_001" people={[]} pending={false} onSend={(_body, _files, clear) => clear()} onTextChange={changed} />;
const changed = vi.fn();

describe('Composer onTextChange', () => {
  it('is called with the new text at each key, and with an empty text after a send', async () => {
    changed.mockClear();
    await renderWithRuntime(box());
    const field = await screen.findByRole('textbox', { name: 'Message' });
    await userEvent.type(field, 'Hi');
    expect(changed.mock.calls.map((call) => call[0])).toEqual(['H', 'Hi']);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(''));
    expect(field).toHaveValue('');
  });

  it('is not called for a draft that comes back', async () => {
    changed.mockClear();
    const first = await renderWithRuntime(box());
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Draft');
    first.unmount();
    changed.mockClear();
    await renderWithRuntime(box());
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Draft');
    expect(changed).not.toHaveBeenCalled();
  });

  it('works with no onTextChange', async () => {
    await renderWithRuntime(<Composer id="cnv_001" people={[]} pending={false} onSend={() => undefined} />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'ok');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('ok');
  });
});
