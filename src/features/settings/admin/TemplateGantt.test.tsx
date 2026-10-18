import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';
import { initI18n } from '../../../i18n';
import { TemplateGantt } from './TemplateGantt';
import type { TemplateDraft, DraftTask } from './templateDraft';

/**
 * The template timeline (fbk_008 item 6). Chart: 20 working days of stage one and 10 of stage two, so the chart shows 35 days. The
 * track is 350 px wide in these tests, so one working day is 10 px.
 */
const task = (id: string, stageId: string, title: string, start: string, days: string, extra: Partial<DraftTask> = {}): DraftTask => ({
  id, stageId, title, roleId: '', start, days, flexible: true, description: '', checklist: [], needsReview: false, ...extra,
});

const DRAFT: TemplateDraft = {
  name: 'Villa',
  roles: [],
  stages: [
    { id: 's1', name: 'Concept', start: '0', days: '20' },
    { id: 's2', name: 'Permits', start: '20', days: '10' },
  ],
  tasks: [
    task('t1', 's1', 'Massing', '2', '4', { flexible: false }),
    task('t2', 's1', 'Plans', '6', '5'),
    task('t3', 's2', 'Submit', '20', '3'),
  ],
};

/** Task t3 waits for task t1 already. */
const LINKED: TemplateDraft = { ...DRAFT, tasks: DRAFT.tasks.map((part) => (part.id === 't3' ? { ...part, prerequisiteIds: ['t1'] } : part)) };

function renderGantt(draft: TemplateDraft, onChange = vi.fn()) {
  render(<TemplateGantt draft={draft} onChange={onChange} onClose={() => undefined} />);
  return onChange;
}

/** The task of the last change, read from the draft that the sheet sent. */
function lastTask(onChange: ReturnType<typeof vi.fn>, id: string): DraftTask {
  const sent = onChange.mock.lastCall?.[0] as TemplateDraft;
  const found = sent.tasks.find((part) => part.id === id);
  if (!found) throw new Error(`no task ${id} in the change`);
  return found;
}

beforeAll(() => {
  // The sheet renders on its own here, so it needs the i18next instance that the render helpers start.
  initI18n('en');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A 350 px chart: every element measures 350 px wide, from the start edge at 0. */
function measureChart() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, right: 350, top: 0, bottom: 0, width: 350, height: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

describe('the template timeline', () => {
  it('shows one row for each stage, with its tasks under it', () => {
    measureChart();
    renderGantt(DRAFT);
    expect(document.querySelectorAll('[data-row="stage"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-row="task"]')).toHaveLength(3);
    expect(screen.getByText('Massing')).toBeInTheDocument();
    expect(screen.getByText('Permits')).toBeInTheDocument();
  });

  it('moves a task start with the arrow keys: one working day, or five with Shift', () => {
    measureChart();
    const onChange = renderGantt(DRAFT);
    const start = screen.getByRole('slider', { name: 'Start of Massing' });
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(lastTask(onChange, 't1')).toMatchObject({ start: '3', days: '4' });
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    expect(lastTask(onChange, 't1')).toMatchObject({ start: '7' });
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    expect(lastTask(onChange, 't1')).toMatchObject({ start: '1' });
  });

  it('changes a task length with its end handle, and keeps at least one day', () => {
    measureChart();
    const onChange = renderGantt(DRAFT);
    const end = screen.getByRole('slider', { name: 'End of Massing' });
    fireEvent.keyDown(end, { key: 'ArrowRight' });
    expect(lastTask(onChange, 't1')).toMatchObject({ start: '2', days: '5' });
    fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true });
    expect(lastTask(onChange, 't1')).toMatchObject({ days: '1' });
  });

  it('moves a stage, and each of its tasks moves by the same working days', () => {
    measureChart();
    const onChange = renderGantt(DRAFT);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start of Concept' }), { key: 'ArrowRight' });
    const sent = onChange.mock.lastCall?.[0] as TemplateDraft;
    expect(sent.stages.find((part) => part.id === 's1')).toMatchObject({ start: '1', days: '20' });
    expect(sent.tasks.find((part) => part.id === 't1')).toMatchObject({ start: '3' });
    expect(sent.tasks.find((part) => part.id === 't2')).toMatchObject({ start: '7' });
    expect(sent.tasks.find((part) => part.id === 't3')).toMatchObject({ start: '20' });
  });

  it('drags a task bar to move its start', () => {
    measureChart();
    const onChange = renderGantt(DRAFT);
    const bar = screen.getByRole('slider', { name: 'Start of Massing' });
    fireEvent.pointerDown(bar, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 70, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 70, pointerId: 1 });
    expect(lastTask(onChange, 't1')).toMatchObject({ start: '7', days: '4' });
  });

  it('sends no change when a bar is pressed and let go in the same place', () => {
    measureChart();
    const onChange = renderGantt(DRAFT);
    const bar = screen.getByRole('slider', { name: 'Start of Massing' });
    fireEvent.pointerDown(bar, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 20, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drags the end of a task to change its length', () => {
    measureChart();
    const onChange = renderGantt(DRAFT);
    const end = screen.getByRole('slider', { name: 'End of Massing' });
    fireEvent.pointerDown(end, { clientX: 60, pointerId: 1 });
    fireEvent.pointerMove(end, { clientX: 90, pointerId: 1 });
    fireEvent.pointerUp(end, { clientX: 90, pointerId: 1 });
    expect(lastTask(onChange, 't1')).toMatchObject({ start: '2', days: '7' });
  });

  it('makes a task wait for another when its dot is dragged onto that bar', () => {
    measureChart();
    const onChange = renderGantt(DRAFT);
    const dot = document.querySelector<HTMLElement>('[data-link-from="t1"]');
    expect(dot).not.toBeNull();
    fireEvent.pointerDown(dot!, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Start of Submit' }), { clientX: 200, pointerId: 1 });
    expect(lastTask(onChange, 't3').prerequisiteIds).toEqual(['t1']);
  });

  it('refuses a link that would make a loop, and says so', () => {
    measureChart();
    const onChange = renderGantt(LINKED);
    // t3 waits for t1 already. A link from t3 to t1 would make t1 wait for t3.
    const dot = document.querySelector<HTMLElement>('[data-link-from="t3"]');
    fireEvent.pointerDown(dot!, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Start of Massing' }), { clientX: 20, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This link would make a loop.');
  });

  it('removes a link after a click on it and a press on Remove link', async () => {
    measureChart();
    const onChange = renderGantt(LINKED);
    expect(screen.queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument();
    const link = document.querySelector<SVGPathElement>('[data-link="t1>t3"]');
    expect(link).not.toBeNull();
    fireEvent.click(link!);
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(lastTask(onChange, 't3').prerequisiteIds).toBeUndefined();
  });
});

describe('the timeline button of the template editor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the timeline from the editor, which keeps the same draft', async () => {
    await renderApp('/admin/project-templates');
    const section = await screen.findByRole('region', { name: 'Project templates' });
    await userEvent.click(within(section).getByRole('button', { name: 'New template' }));
    const editor = await screen.findByRole('dialog', { name: 'New project template' });
    await userEvent.click(within(editor).getByRole('button', { name: 'Edit the timeline' }));
    expect(await screen.findByRole('dialog', { name: 'Timeline' })).toBeInTheDocument();
  });

  it('shows the phone message on the button, and the button is off', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)', media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList);
    await renderApp('/admin/project-templates');
    const section = await screen.findByRole('region', { name: 'Project templates' });
    await userEvent.click(within(section).getByRole('button', { name: 'New template' }));
    const editor = await screen.findByRole('dialog', { name: 'New project template' });
    expect(within(editor).getByText('The timeline needs a wider screen.')).toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'Edit the timeline' })).toBeNull();
  });
});

describe('the timeline sheet on its own', () => {
  it('is a sheet with one main button, Done', () => {
    measureChart();
    render(<TemplateGantt draft={DRAFT} onChange={() => undefined} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
