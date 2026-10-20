import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../../i18n';
import { TemplateGantt, type Picked } from './TemplateGantt';
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

function renderGantt(draft: TemplateDraft, onChange = vi.fn(), more: { onLink?: Mock; onSelect?: Mock; selected?: Picked | null } = {}) {
  render(<TemplateGantt draft={draft} onChange={onChange} onLink={more.onLink ?? vi.fn()} onSelect={more.onSelect ?? vi.fn()} selected={more.selected ?? null} />);
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

  it('says that a chart with no bar needs days, and says nothing when a bar shows', () => {
    measureChart();
    renderGantt({ ...DRAFT, stages: DRAFT.stages.map((stage) => ({ ...stage, start: '', days: '' })), tasks: [] });
    expect(screen.getByText('Add a to-do with a start day and working days to see the timeline.')).toBeInTheDocument();
  });

  it('shows no empty-chart note when the draft has bars', () => {
    measureChart();
    renderGantt(DRAFT);
    expect(screen.queryByText('Add a to-do with a start day and working days to see the timeline.')).toBeNull();
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

  it('asks the editor to link two tasks when a dot is dragged onto another bar, and changes nothing itself', () => {
    measureChart();
    const onLink = vi.fn();
    const onChange = renderGantt(DRAFT, vi.fn(), { onLink });
    const dot = document.querySelector<HTMLElement>('[data-link-from="t1"]');
    expect(dot).not.toBeNull();
    fireEvent.pointerDown(dot!, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Start of Submit' }), { clientX: 200, pointerId: 1 });
    expect(onLink).toHaveBeenCalledWith('task', 't3', 't1');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a link that would make a loop, and says so', () => {
    measureChart();
    const onLink = vi.fn();
    renderGantt(LINKED, vi.fn(), { onLink });
    // t3 waits for t1 already. A link from t3 to t1 would make t1 wait for t3.
    const dot = document.querySelector<HTMLElement>('[data-link-from="t3"]');
    fireEvent.pointerDown(dot!, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Start of Massing' }), { clientX: 20, pointerId: 1 });
    expect(onLink).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This link would make a loop.');
  });

  it('picks the part that waits when a link is pressed, so its details show what it waits for', () => {
    measureChart();
    const onSelect = vi.fn();
    renderGantt(LINKED, vi.fn(), { onSelect });
    fireEvent.click(document.querySelector<SVGPathElement>('[data-link="t1>t3"]')!);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'task', id: 't3' });
  });
});

describe('the timeline as the main view of the editor (ADM-06, ADM-07, ADM-09)', () => {
  it('picks a part from its name and from its bar', async () => {
    measureChart();
    const onSelect = vi.fn();
    renderGantt(DRAFT, vi.fn(), { onSelect });
    await userEvent.click(screen.getByRole('button', { name: 'Plans' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'task', id: 't2' });
    fireEvent.click(screen.getByRole('slider', { name: 'Start of Permits' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'stage', id: 's2' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start of Massing' }), { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'task', id: 't1' });
  });

  it('marks the picked row, and shows the full name of a part in a tooltip', () => {
    measureChart();
    renderGantt(DRAFT, vi.fn(), { selected: { kind: 'task', id: 't2' } });
    expect(screen.getByRole('button', { name: 'Plans' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Massing' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Massing' })).toHaveAttribute('title', 'Massing');
  });

  it('shows the link dot and the end grip only for a bar that has the pointer, the focus or the pick', () => {
    measureChart();
    renderGantt(DRAFT, vi.fn(), { selected: { kind: 'task', id: 't2' } });
    const dotOf = (id: string) => document.querySelector<HTMLElement>(`[data-link-from="${id}"]`)!;
    expect(dotOf('t1').className).toContain('opacity-0');
    expect(dotOf('t1').className).toContain('group-hover:opacity-100');
    expect(dotOf('t1').className).toContain('group-focus-within:opacity-100');
    expect(dotOf('t2').className).toContain('opacity-100');
    expect(dotOf('t2').className).not.toContain(' opacity-0');
  });

  it('has a legend, the length of the template, and a Fit and Zoom in choice', async () => {
    measureChart();
    renderGantt(DRAFT);
    expect(screen.getByText('Can stretch')).toBeInTheDocument();
    expect(screen.getByText('Keeps its length')).toBeInTheDocument();
    expect(screen.getByText('Length: 30 working days')).toBeInTheDocument();
    const fit = screen.getByRole('radio', { name: 'Fit' });
    expect(fit).toBeChecked();
    const track = document.querySelector<HTMLElement>('[data-row]')!.parentElement!.parentElement as HTMLElement;
    const narrow = track.style.minWidth;
    await userEvent.click(screen.getByRole('radio', { name: 'Zoom in' }));
    expect(track.style.minWidth).not.toBe(narrow);
    expect(parseInt(track.style.minWidth, 10)).toBeGreaterThan(parseInt(narrow, 10));
  });
});
