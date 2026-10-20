import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { addDays, todayISO } from '../../lib/dates';
import { renderApp } from '../../test/render';

// In the sample office, usr_005 leads Civil Defense drawings (tsk_012).
describe('a task far past due on Home (fbk_036)', () => {
  it('lets the past-due words wrap, so they never run under the chat button of the row', async () => {
    await renderApp('/', (state) => {
      state.session.currentUserId = 'usr_005';
      state.tasks.tsk_012.startDate = null;
      state.tasks.tsk_012.dueDate = addDays(todayISO(), -157);
    });
    const panel = await screen.findByRole('region', { name: 'Today' });
    const row = within(panel).getAllByRole('listitem').find((item) => item.textContent?.includes('Civil Defense drawings')) as HTMLElement;
    const sign = row.querySelector('[data-sign="late"]') as HTMLElement;
    expect(sign.textContent).toContain('157');
    expect(sign.className).toContain('whitespace-normal');
    expect(sign.className).not.toContain('shrink-0');
  });
});
