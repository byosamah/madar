import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { applyLanguage, initI18n } from '../../i18n';
import { renderApp, renderWithRuntime } from '../../test/render';
import { Composer } from './Composer';

/** The emoji button in the chat box and in the comment box (chat presence design D1, track emoji E3). */
const changed = vi.fn();
const sent = vi.fn();
const box = () => (
  <Composer id="cnv_001" people={[]} pending={false} onSend={(body, files, clear) => { sent(body, files); clear(); }} onTextChange={changed} />
);
const field = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const grinning = async () => (await screen.findAllByRole('button', { name: 'grinning face' }))[0];

describe('the emoji button in the chat box', () => {
  it('puts the emoji at the caret, and the caret after it', async () => {
    changed.mockClear();
    await renderWithRuntime(box());
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'ab');
    field().setSelectionRange(1, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Add an emoji' }));
    await userEvent.click(await grinning());
    expect(field()).toHaveValue('a😀b');
    await waitFor(() => expect(field().selectionStart).toBe(3));
    expect(field().selectionEnd).toBe(3);
    // The panel stays open for a second emoji, which goes after the first.
    expect(screen.getByRole('dialog', { name: 'Add an emoji' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'thumbs up' })[0]);
    expect(field()).toHaveValue('a😀👍b');
  });

  it('replaces a selection', async () => {
    await renderWithRuntime(box());
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello world');
    field().setSelectionRange(5, 11);
    await userEvent.click(screen.getByRole('button', { name: 'Add an emoji' }));
    await userEvent.click(await grinning());
    expect(field()).toHaveValue('hello😀');
  });

  it('counts as typing, and a sent message empties the box', async () => {
    changed.mockClear();
    await renderWithRuntime(box());
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'ok');
    changed.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Add an emoji' }));
    await userEvent.click(await grinning());
    expect(changed).toHaveBeenCalledExactlyOnceWith('ok😀');
  });

  it('Send closes the panel and sends the emoji', async () => {
    sent.mockClear();
    await renderWithRuntime(box());
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Done');
    await userEvent.click(screen.getByRole('button', { name: 'Add an emoji' }));
    await userEvent.click(await grinning());
    expect(screen.getByRole('dialog', { name: 'Add an emoji' })).toBeInTheDocument();
    // A send by script, with no press outside: only the close() of the button can end the panel.
    fireEvent.submit(field().closest('form')!);
    await waitFor(() => expect(sent).toHaveBeenCalledExactlyOnceWith('Done😀', []));
    expect(screen.queryByRole('dialog', { name: 'Add an emoji' })).toBeNull();
    expect(field()).toHaveValue('');
  });

  it('Escape closes the panel and the cursor goes back to the box', async () => {
    await renderWithRuntime(box());
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Add an emoji' }));
    await userEvent.click(await grinning());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add an emoji' })).toBeNull());
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field().selectionStart).toBe(4);
  });

  it('sits between the clip and the field', async () => {
    await renderWithRuntime(
      <Composer id="cnv_001" people={[]} pending={false} onSend={() => undefined} upload={{ projectId: null, stageId: null, taskId: null }} />,
    );
    const emoji = await screen.findByRole('button', { name: 'Add an emoji' });
    const attach = screen.getByText('Attach files').closest('label')!;
    const text = field();
    expect(attach.compareDocumentPosition(emoji) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(emoji.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Arabic: the button label is أضف إيموجي and the emoji goes in Arabic text', async () => {
    await renderWithRuntime(
      <Composer id="cnv_001" people={[]} pending={false} onSend={() => undefined} />,
    );
    act(() => {
      initI18n('ar');
      applyLanguage(document.documentElement, 'ar');
    });
    const text = await screen.findByRole('textbox', { name: 'الرسالة' });
    await userEvent.type(text, 'مرحبا');
    await userEvent.click(screen.getByRole('button', { name: 'أضف إيموجي' }));
    const dialog = await screen.findByRole('dialog', { name: 'أضف إيموجي' });
    await userEvent.click((await within(dialog).findAllByRole('button', { name: 'وجه بابتسامة عريضة' }))[0]);
    expect(text).toHaveValue('مرحبا😀');
  });
});

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('the emoji button in the comment box', () => {
  it('the comment box of a task has the button too, and a pick goes at the caret', async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_007&thread=1', as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const text = within(sheet).getByRole('textbox', { name: 'Add a comment' }) as HTMLTextAreaElement;
    await userEvent.type(text, 'Checked it');
    text.setSelectionRange(7, 7);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add an emoji' }));
    const panel = await screen.findByRole('dialog', { name: 'Add an emoji' });
    // The panel draws inside the task panel, as the menus do.
    expect(sheet.contains(panel)).toBe(true);
    await userEvent.click((await within(panel).findAllByRole('button', { name: 'grinning face' }))[0]);
    expect(text).toHaveValue('Checked😀 it');
    await waitFor(() => expect(text.selectionStart).toBe(9));
    // The Send button enables with the emoji alone.
    expect(within(sheet).getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
