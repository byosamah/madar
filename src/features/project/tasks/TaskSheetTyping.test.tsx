import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const TASK = '/projects/prj_001?tab=tasks&task=tsk_007';
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const field = (sheet: HTMLElement, label: string) => within(sheet).getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;

// The title and the description each take a new saved value on their own (review 2026-10-25). Before, the answer of one save put
// back both fields, so the words that the person typed in the other field went away.
describe('the task panel keeps what the person types while a save comes back (review 2026-10-25)', () => {
  it('keeps a description typed while the title save goes', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    fireEvent.change(field(sheet, 'Title'), { target: { value: 'Stair rails' } });
    fireEvent.blur(field(sheet, 'Title'));
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Bring the drone.' } });
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair rails'));
    // The panel name follows the saved title, so the answer of the save is on the screen now.
    await screen.findByRole('dialog', { name: 'Stair rails' });
    expect(field(sheet, 'Description').value).toBe('Bring the drone.');
  });

  it('keeps a title typed while the description save goes', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'Bring the drone.' } });
    fireEvent.blur(field(sheet, 'Description'));
    fireEvent.change(field(sheet, 'Title'), { target: { value: 'Stair rails' } });
    await waitFor(() => expect(store.state.tasks.tsk_007.description).toBe('Bring the drone.'));
    await act(() => new Promise((done) => setTimeout(done, 100)));
    expect(field(sheet, 'Title').value).toBe('Stair rails');
  });

  it('keeps typing that is not saved yet when another person changes the same task', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    fireEvent.change(field(sheet, 'Description'), { target: { value: 'My notes, not saved yet.' } });
    act(() => {
      store.run((state) => {
        state.tasks.tsk_007.title = 'Stair sections';
        state.tasks.tsk_007.description = 'Their notes.';
      });
    });
    await screen.findByRole('dialog', { name: 'Stair sections' });
    expect(field(sheet, 'Title').value).toBe('Stair sections');
    expect(field(sheet, 'Description').value).toBe('My notes, not saved yet.');
  });

  it('shows the change of another person in a field that holds no typing', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    act(() => {
      store.run((state) => {
        state.tasks.tsk_007.description = 'Their notes.';
      });
    });
    await waitFor(() => expect(field(sheet, 'Description').value).toBe('Their notes.'));
  });
});
