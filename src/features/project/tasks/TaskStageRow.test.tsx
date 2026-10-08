import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../../../test/render';

const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}`;

describe('the stage field of the task panel', () => {
  // A stage name such as Construction Documents is long. In a two-column grid, Arabic text cut its first letters.
  // From the small breakpoint (640 px) up, the stage field takes a full row.
  it('takes a full row, so a long stage name is not cut', async () => {
    await renderApp(TASK('tsk_007'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const stage = within(sheet).getByLabelText('Stage');
    expect(stage.closest('.grid > *')).toHaveClass('sm:col-span-2');
  });
});
