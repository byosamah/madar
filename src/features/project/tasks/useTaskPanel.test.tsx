import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderPanel, setupTask } from '../../../test/renderPanel';
import type { TaskPanel } from './useTaskPanel';

function Probe({ panel }: { panel: TaskPanel }) {
  const { search } = useLocation();
  return (
    <div>
      <output aria-label="may change">{String(panel.mayChange)}</output>
      <output aria-label="section">{panel.section}</output>
      <output aria-label="search">{search}</output>
      <button type="button" onClick={() => panel.complete.mutate({ id: panel.task.id })}>Finish</button>
      <button type="button" onClick={() => panel.setSection('details')}>Details</button>
    </div>
  );
}
const show = (panel: TaskPanel) => <Probe panel={panel} />;

describe('useTaskPanel', () => {
  it('says that an outsider may not change the to-do', async () => {
    await renderPanel('tsk_011', { prepare: setupTask('tsk_011', 'usr_005'), render: show });
    expect(await screen.findByLabelText('may change')).toHaveTextContent('false');
  });

  it('says that the lead may change it', async () => {
    await renderPanel('tsk_007', { prepare: setupTask('tsk_007', 'usr_005', { ownerId: 'usr_005' }), render: show });
    expect(await screen.findByLabelText('may change')).toHaveTextContent('true');
  });

  it('sends a to-do with Needs review to review for its lead', async () => {
    const { store } = await renderPanel('tsk_007', {
      prepare: setupTask('tsk_007', 'usr_005', { ownerId: 'usr_005', status: 'todo', needsReview: true }),
      render: show,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.status).toBe('in_review'));
  });

  it('opens the Conversation when the link has thread=1', async () => {
    await renderPanel('tsk_007', { prepare: setupTask('tsk_007', 'usr_006'), path: '/?task=tsk_007&thread=1', render: show });
    expect(await screen.findByLabelText('section')).toHaveTextContent('conversation');
    expect(screen.getByLabelText('search')).toHaveTextContent('thread=1');
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    await waitFor(() => expect(screen.getByLabelText('section')).toHaveTextContent('details'));
    expect(screen.getByLabelText('search').textContent).not.toContain('thread');
  });
});
