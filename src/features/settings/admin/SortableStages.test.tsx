import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

/**
 * The stage list of the project template editor takes a new order by drag (fbk_008 item 2). The sample template "Villa, full
 * design" has five stages with no own days: Concept starts on day 0 and Schematic Design on day 12.
 */
const VILLA_ORDER = ['Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits'];
const NOTE = 'Starts before the stage above.';
const stageNames = (sheet: HTMLElement) => within(sheet).getAllByLabelText(/^Name of stage \d+$/).map((field) => (field as HTMLInputElement).value);

async function openVilla() {
  const { store } = await renderApp('/admin/project-templates');
  const section = await screen.findByRole('region', { name: 'Project templates' });
  await userEvent.click(await within(section).findByRole('button', { name: /^Villa, full design/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Villa, full design' });
  return { store, sheet };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the stage list of the project template editor', () => {
  it('moves a stage down one place with the keyboard, and names the new place', async () => {
    const { sheet } = await openVilla();
    // jsdom has no layout, so each stage card gets a box under the one before it.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
      const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
      const top = at >= 0 ? at * 60 : 0;
      const height = at >= 0 ? 56 : 0;
      return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    expect(stageNames(sheet)).toEqual(VILLA_ORDER);
    const grip = within(sheet).getByRole('button', { name: 'Move stage 1 up or down' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    // The place message replaces the pick-up message at once, so the place message is the one to wait for.
    expect(await screen.findByText('Concept is at place 1 of 5.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    expect(await screen.findByText('Concept is at place 2 of 5.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    });
    await waitFor(() => expect(stageNames(sheet)).toEqual(['Schematic Design', 'Concept', 'Design Development', 'Construction Documents', 'Permits']));
    expect(await screen.findByText('Concept is now at place 2 of 5.')).toBeInTheDocument();
  });

  it('cancels a stage move with Escape, and keeps the sheet and the order', async () => {
    const { sheet } = await openVilla();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const item = this.parentElement?.tagName === 'LI' ? this.parentElement : this.tagName === 'LI' ? this : null;
      const at = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
      const top = at >= 0 ? at * 60 : 0;
      const height = at >= 0 ? 56 : 0;
      return { left: 0, top, width: 300, height, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const grip = within(sheet).getByRole('button', { name: 'Move stage 1 up or down' });
    grip.focus();
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' });
    // The place message replaces the pick-up message at once, so the place message is the one to wait for.
    expect(await screen.findByText('Concept is at place 1 of 5.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: 'ArrowDown', code: 'ArrowDown' });
    });
    expect(await screen.findByText('Concept is at place 2 of 5.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' });
    });
    expect(await screen.findByText('The move of Concept is cancelled.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Villa, full design' })).toBeInTheDocument();
    expect(stageNames(sheet)).toEqual(VILLA_ORDER);
  });

  it('keeps Move down in the stage menu', async () => {
    const { sheet } = await openVilla();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Actions for stage 1' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move down' }));
    expect(stageNames(sheet)).toEqual(['Schematic Design', 'Concept', 'Design Development', 'Construction Documents', 'Permits']);
  });

  it('shows a note on a stage that starts before the stage above it, and on no other stage', async () => {
    const { sheet } = await openVilla();
    expect(within(sheet).queryByText(NOTE)).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Actions for stage 1' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move down' }));
    // Concept starts on day 0, before Schematic Design, which starts on day 12. Concept is now the second stage.
    const card = within(sheet).getByLabelText('Name of stage 2').closest('li') as HTMLElement;
    expect(within(card).getByText(NOTE)).toBeInTheDocument();
    expect(within(sheet).getAllByText(NOTE)).toHaveLength(1);
  });
});
