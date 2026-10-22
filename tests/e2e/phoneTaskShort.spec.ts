import { devices, expect, test } from '@playwright/test';

// Direction D, the task Conversation on a short phone: WebKit, iPhone 15, 393 x 659. The Conversation opens scrolled to the newest comment.
// The newest comment must end above the docked comment box, no strip of comments may show below the box, and the title of the to-do
// must not sit half under the top row of the sheet.
test.use({ ...devices['iPhone 15'] });

test('the Conversation scrolls to the newest comment and the title is not cut in half, at 393 x 659', async ({ page }) => {
  await page.goto('/#/projects/prj_001?tab=tasks&task=tsk_007&thread=1');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('textbox', { name: 'Add a comment' })).toBeVisible();
  await expect(sheet.getByText('Done.', { exact: false }).first()).toBeVisible();
  // Wait for the one scroll to end.
  await page.waitForTimeout(1200);
  const box = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    const dock = dialog.querySelector('[data-comment-dock]')!;
    let scroller: HTMLElement | null = dock.parentElement;
    while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
    const top = (el: Element) => el.getBoundingClientRect().top;
    const bottom = (el: Element) => el.getBoundingClientRect().bottom;
    const comments = [...dialog.querySelectorAll('li')];
    const title = [...dialog.querySelectorAll('button, p')].find((el) => el.textContent?.includes('Stair details'));
    return {
      innerHeight: window.innerHeight, innerWidth: window.innerWidth,
      scrolled: scroller!.scrollTop, overflow: scroller!.scrollHeight - scroller!.clientHeight,
      scrollerTop: top(scroller!), scrollerBottom: bottom(scroller!),
      dockTop: top(dock), dockBottom: bottom(dock),
      newestBottom: bottom(comments[comments.length - 1]!),
      titleTop: title ? top(title) : null, titleBottom: title ? bottom(title) : null,
    };
  });
  console.log(JSON.stringify(box));
  expect(box.innerWidth).toBe(393);
  expect(box.innerHeight).toBe(659);
  // The page needs a scroll here: the case that failed.
  expect(box.overflow).toBeGreaterThan(40);
  // The box reaches the bottom edge of the scroll area, so no comment shows below it.
  expect(Math.abs(box.dockBottom - box.scrollerBottom)).toBeLessThanOrEqual(1);
  // The newest comment ends above the box.
  expect(box.newestBottom).toBeLessThanOrEqual(box.dockTop + 1);
  // The title is whole or gone, never cut by the top row.
  if (box.titleTop !== null && box.titleBottom !== null) {
    const cut = box.titleTop < box.scrollerTop && box.titleBottom > box.scrollerTop;
    expect(cut, 'the title is not cut by the top row').toBe(false);
  }
});
