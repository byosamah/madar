import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPanel, setupTask } from '../../../test/renderPanel';
import { StateLine } from './StateLine';
import type { TaskPanel } from './useTaskPanel';

// The office clock stands on 2026-09-30.
const line = (panel: TaskPanel) => <div data-testid="line"><StateLine data={panel.data} /></div>;
const lineFor = async (patch: Parameters<typeof setupTask>[2], extra?: (state: Parameters<ReturnType<typeof setupTask>>[0]) => void) => {
  await renderPanel('tsk_007', {
    phone: true,
    prepare: (state) => {
      setupTask('tsk_007', 'usr_002', { startDate: null, ...patch })(state);
      extra?.(state);
    },
    render: line,
  });
  return screen.findByTestId('line');
};

describe('StateLine', () => {
  it('shows the status word, then the due word', async () => {
    const box = await lineFor({ status: 'in_progress', dueDate: '2026-09-28' });
    expect(box).toHaveTextContent('In progress');
    expect(box.querySelector('[data-sign="late"]')).toHaveTextContent('2 days past due');
  });

  it('shows no late sign for a to-do in review, only a quiet date', async () => {
    const box = await lineFor({ status: 'in_review', dueDate: '2026-09-28' });
    expect(box).toHaveTextContent(/Due 28 Sep/);
    expect(box.querySelector('[data-sign]')).toBeNull();
  });

  it('shows Starts <date> and no due word when the start is later', async () => {
    const box = await lineFor({ status: 'todo', startDate: '2026-10-04', dueDate: '2026-10-20' });
    expect(box).toHaveTextContent('Starts Sun 4 Oct');
    expect(box).not.toHaveTextContent(/Due|past due/);
  });

  it('shows no due word for a done to-do', async () => {
    const box = await lineFor({ status: 'done', dueDate: '2026-09-20' });
    expect(box).toHaveTextContent('Done');
    expect(box).not.toHaveTextContent(/Due|past due/);
  });

  it('shows Flagged in text-attn, the version badge from version 2, and Waiting for X', async () => {
    const box = await lineFor(
      { status: 'todo', flagged: true, version: 2 },
      (state) => {
        state.tasks.tsk_007.prerequisiteIds = ['tsk_006'];
        state.tasks.tsk_006.status = 'in_progress';
      },
    );
    expect(screen.getByText('Flagged')).toHaveClass('text-attn');
    expect(box).toHaveTextContent('v2');
    expect(box).toHaveTextContent(/Waiting for /);
  });

  it('shows only what is true', async () => {
    const box = await lineFor({ status: 'todo', dueDate: null, flagged: false });
    expect(box.firstElementChild?.children).toHaveLength(1);
    expect(box).toHaveTextContent('To do');
  });
});
