import { describe, expect, it } from 'vitest';
import { SWIPE_PX, swipeArchives } from './swipe';

/**
 * The swipe that archives a row of the Inbox (owner, 2026-11-08: "Longer swipe, keep the unread mark"). A drag of 80 px archived a chat by
 * accident while the person scrolled or held the phone. The row now needs about twice the distance. The real drag is measured in the
 * screenshot run on a 390 px phone.
 */
describe('the swipe that archives a row', () => {
  it('needs more than 160 px, twice the old 80 px', () => {
    expect(SWIPE_PX).toBe(160);
  });

  it('does not archive on a drag of 80 px or of 159 px, on either side', () => {
    for (const dx of [0, 40, 80, 120, 159, 160, -80, -159, -160]) expect(swipeArchives(dx), String(dx)).toBe(false);
  });

  it('archives on a drag of more than 160 px, to the end side and to the start side', () => {
    for (const dx of [161, 170, 250, -161, -170, -250]) expect(swipeArchives(dx), String(dx)).toBe(true);
  });

  it('still fits on a phone of 390 px: the drag is less than half of the width of the row', () => {
    expect(SWIPE_PX).toBeLessThan(390 / 2);
  });
});
