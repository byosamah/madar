import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { FAISAL, makeBubble, renderLog, rowOf } from './logHarness';

/**
 * fbk_081: a reaction under a bubble moved the round picture of the sender down. The face row (face, bubble, side spot) must hold
 * neither the reaction row nor the "Not sent" row. jsdom draws no layout, so the test pins the DOM: the box that holds the face
 * holds the bubble too, and the rows under the bubble sit outside that box.
 */
describe('the face stays beside the bubble (fbk_081)', () => {
  it('keeps the reactions of another person outside the box of the face and the bubble', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', createdAt: '2026-09-29T10:00:00.000+03:00', body: 'Look at this.', reactions: { '👍': ['usr_001'], '❤️': ['usr_004'] } })] });
    const row = rowOf('Look at this.');
    const face = within(row).getByRole('img', { name: 'Faisal Al-Harbi' });
    const faceRow = face.parentElement as HTMLElement;
    const group = within(row).getByRole('group', { name: 'Reactions' });
    expect(faceRow).not.toBe(row);
    expect(faceRow.contains(screen.getByText('Look at this.'))).toBe(true);
    expect(faceRow.contains(group)).toBe(false);
    expect(row.contains(group)).toBe(true);
    // The side spot is in the same box as the face, so it centers on the bubble and not on bubble plus reactions.
    expect(faceRow.contains(row.querySelector('[data-part="side"]'))).toBe(true);
    // The reaction row lines up with the bubble: the indent of the face (28 px) and its gap (8 px), as a logical class.
    expect(group.className).toMatch(/(^|\s)ps-9(\s|$)/);
  });
  it('keeps the reactions of an own message outside the box of its bubble and side spot, with no indent', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_2', createdAt: '2026-09-29T10:00:00.000+03:00', body: 'My note.', mine: true, author: FAISAL, reactions: { '👍': ['usr_004'] } })] });
    const row = rowOf('My note.');
    const group = within(row).getByRole('group', { name: 'Reactions' });
    const side = row.querySelector('[data-part="side"]') as HTMLElement;
    const sideRow = side.parentElement as HTMLElement;
    expect(sideRow).not.toBe(row);
    expect(sideRow.contains(screen.getByText('My note.'))).toBe(true);
    expect(sideRow.contains(group)).toBe(false);
    expect(row.contains(group)).toBe(true);
    expect(group.className).not.toMatch(/ps-9/);
  });
  it('keeps the "Not sent" row outside the box of the face and the bubble', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_3', createdAt: '2026-09-29T10:00:00.000+03:00', body: 'Lost words.', status: 'failed' })] });
    const row = rowOf('Lost words.');
    const face = within(row).getByRole('img', { name: 'Faisal Al-Harbi' });
    const faceRow = face.parentElement as HTMLElement;
    const notSent = within(row).getByText('Not sent');
    expect(faceRow).not.toBe(row);
    expect(faceRow.contains(notSent)).toBe(false);
    expect(row.contains(notSent)).toBe(true);
  });
});
