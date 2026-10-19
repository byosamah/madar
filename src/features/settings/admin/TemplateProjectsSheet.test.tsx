import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectTemplate } from '../../../api/contract/entities';
import { calls } from '../../../api/calls';
import { createApi } from '../../../api/client';
import { memoryPersister } from '../../../api/persist';
import { Store } from '../../../api/store';
import { RuntimeProvider, createQueryClient } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { buildSeed } from '../../../data/seed';
import { sampleOffice } from '../../../data/sampleOffice';
import { initI18n } from '../../../i18n';
import { setNow } from '../../../lib/dates';
import { NOW, TODAY } from '../../../test/factories';
import { TemplateProjectsSheet } from './TemplateProjectsSheet';

/**
 * "Projects using this template" (fbk_008 item 4; ADM-04). The template "Villa" has two stages, Concept and Permits, and two tasks. Two
 * projects are linked to it, "Harbour Offices" and "Lake House", and "Office refit" is open and not linked. The review is one screen
 * that names every change, and the update ends with a toast that has one Undo.
 */
const TEMPLATE = {
  name: 'Villa',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 10, durationDays: 5, flexible: true },
  ],
};

const SITE_PHOTOS = { id: 't3', stageId: 's1', title: 'Site photos', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 0, durationDays: 2, flexible: true };

async function setUp() {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0, sampleOffice });
  initI18n('en');
  const { id: templateId } = await api.call('projectTemplates.save', TEMPLATE as never);
  const template = store.state.projectTemplates![templateId] as ProjectTemplate;
  const fromTemplate = { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] };
  const harbour = (await api.call('projects.create', { name: 'Harbour Offices', template: fromTemplate })).project.id;
  const lake = (await api.call('projects.create', { name: 'Lake House', template: fromTemplate })).project.id;
  const refit = (await api.call('projects.create', { name: 'Office refit', stages: ['Concept'] })).project.id;
  return { api, store, template, templateId, harbour, lake, refit };
}
type Ctx = Awaited<ReturnType<typeof setUp>>;

/** The tasks that came from the new template part "Site photos" (t3), in every project. */
const sitePhotos = (ctx: Ctx) => Object.values(ctx.store.state.tasks).filter((task) => task.templatePartId === 't3');
/** The planned due date of the second task in one project. */
const permitsDue = (ctx: Ctx, projectId: string) => Object.values(ctx.store.state.tasks).find((task) => task.projectId === projectId && task.templatePartId === 't2')!.dueDate;

/** Adds the task "Site photos" to the template, so each linked project lacks one item. */
async function addSitePhotos(ctx: Ctx) {
  await ctx.api.call('projectTemplates.save', { ...TEMPLATE, id: ctx.templateId, tasks: [...TEMPLATE.tasks, SITE_PHOTOS] } as never);
}

/** The template with a longer second task, so each linked project has one planned date that moves. */
async function longerPermits(ctx: Ctx) {
  await ctx.api.call('projectTemplates.save', { ...TEMPLATE, id: ctx.templateId, tasks: [TEMPLATE.tasks[0], { ...TEMPLATE.tasks[1], durationDays: 7 }] } as never);
}

/** The sheet, with a close that takes it off the screen (a screen does the same). */
function Host({ template, onClose, reviewAll }: { template: ProjectTemplate; onClose: () => void; reviewAll?: boolean }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <TemplateProjectsSheet template={template} reviewAll={reviewAll} onClose={() => { setOpen(false); onClose(); }} />;
}

async function openSheet(ctx: Ctx, reviewAll = false) {
  const onClose = vi.fn();
  render(
    <RuntimeProvider runtime={{ store: ctx.store, api: ctx.api }} queryClient={createQueryClient()}>
      <ToastProvider>
        <Host template={ctx.template} onClose={onClose} reviewAll={reviewAll} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  if (!reviewAll) await screen.findByRole('region', { name: 'Linked projects' });
  return { onClose };
}

/** Picks every linked project and goes to the review. */
async function reachReview() {
  await userEvent.click(screen.getByRole('button', { name: 'All' }));
  await userEvent.click(screen.getByRole('button', { name: 'Review the changes' }));
  return screen.findByRole('dialog', { name: 'Review the changes' });
}

describe('Projects using this template', () => {
  it('lists the linked projects with their state, and the open projects that are not linked under Not linked yet', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    const linked = screen.getByRole('region', { name: 'Linked projects' });
    expect(within(linked).getByRole('checkbox', { name: /Harbour Offices/ })).toBeInTheDocument();
    expect(within(linked).getByRole('checkbox', { name: /Lake House/ })).toBeInTheDocument();
    expect(within(linked).getAllByText('Active')).toHaveLength(2);
    const notLinked = screen.getByRole('region', { name: 'Not linked yet' });
    expect(within(notLinked).getByRole('button', { name: 'Link Office refit' })).toBeInTheDocument();
  });

  it('ticks every linked project with All, clears them with None, and needs one pick before the review', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    expect(screen.getByRole('button', { name: 'Review the changes' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('checkbox', { name: /Harbour Offices/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Lake House/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Review the changes' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByRole('checkbox', { name: /Lake House/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Review the changes' })).toBeDisabled();
  });

  it('shows every change on one screen with the name of each task, and sends nothing before the main button', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    await openSheet(ctx);
    const review = await reachReview();
    const card = within(review).getByRole('region', { name: 'New items' });
    expect(within(card).getByText('2 items in 2 projects')).toBeInTheDocument();
    expect(within(card).getAllByText('Site photos')).toHaveLength(2);
    expect(within(card).getByText('Harbour Offices')).toBeInTheDocument();
    expect(within(card).getByRole('checkbox')).toBeChecked();
    expect(sitePhotos(ctx)).toHaveLength(0);
    // One main button, and no step before it.
    expect(within(review).getAllByRole('button', { name: /^Update/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByText('Updated 2 projects.')).toBeInTheDocument();
    expect(sitePhotos(ctx).map((task) => task.projectId).sort()).toEqual([ctx.harbour, ctx.lake].sort());
    expect(screen.queryByRole('dialog', { name: 'Review the changes' })).not.toBeInTheDocument();
  });

  it('Undo in the toast takes back the changes of every project in one update', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    await openSheet(ctx);
    await reachReview();
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByText('Updated 2 projects.')).toBeInTheDocument();
    expect(sitePhotos(ctx)).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('The update is undone.')).toBeInTheDocument();
    await waitFor(() => expect(sitePhotos(ctx)).toHaveLength(0));
  });

  it('counts and updates only the projects that change (ADM-19)', async () => {
    const ctx = await setUp();
    // Lake House comes after the new task, so it already has it. Only Harbour Offices changes.
    await addSitePhotos(ctx);
    const late = (await ctx.api.call('projects.create', { name: 'Late Lake', template: { templateId: ctx.templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } })).project.id;
    await openSheet(ctx);
    await userEvent.click(screen.getByRole('checkbox', { name: /Late Lake/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Harbour Offices/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Review the changes' }));
    expect(await screen.findByRole('button', { name: 'Update 1 project' })).toBeEnabled();
    expect(late).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Update 1 project' }));
    expect(await screen.findByText('Updated 1 project.')).toBeInTheDocument();
  });

  it('says that the projects match the template, with only a Close button, when nothing changed (ADM-01)', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    const review = await reachReview();
    expect(await within(review).findByText('These projects already match the template.')).toBeInTheDocument();
    expect(within(review).getAllByRole('button').map((button) => button.textContent)).toEqual(['', 'Close']);
  });

  it('keeps what the team wrote when the template did not change', async () => {
    const ctx = await setUp();
    const massing = Object.values(ctx.store.state.tasks).find((task) => task.projectId === ctx.harbour && task.templatePartId === 't1')!;
    ctx.store.state.tasks[massing.id].description = 'Client gate code 4471';
    await openSheet(ctx);
    const review = await reachReview();
    expect(await within(review).findByText('These projects already match the template.')).toBeInTheDocument();
    expect(ctx.store.state.tasks[massing.id].description).toBe('Client gate code 4471');
  });

  it('shows the old and the new dates, asks one reason only while a date tick is on, and moves the date', async () => {
    const ctx = await setUp();
    await longerPermits(ctx);
    const before = permitsDue(ctx, ctx.harbour);
    await openSheet(ctx);
    const review = await reachReview();
    const card = await within(review).findByRole('region', { name: 'Planned dates' });
    expect(within(card).getByText('2 tasks in 2 projects')).toBeInTheDocument();
    expect(within(card).getAllByText(/^Balady pack: .+ to .+ becomes .+ to .+$/)).toHaveLength(2);
    const main = screen.getByRole('button', { name: 'Update 2 projects' });
    expect(main).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /Why do these dates change/ }), 'The client asked for a longer permit review.');
    expect(main).toBeEnabled();
    // The reason goes when the dates tick is off, and then no project changes.
    await userEvent.click(within(card).getByRole('checkbox'));
    expect(screen.queryByRole('textbox', { name: /Why do these dates change/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Update/ })).toBeDisabled();
    await userEvent.click(within(card).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByText('Updated 2 projects.')).toBeInTheDocument();
    expect(permitsDue(ctx, ctx.harbour)).not.toBe(before);
  });

  it('puts a task that the team and the template both changed under "Edited by the team", unticked, and keeps the team version', async () => {
    const ctx = await setUp();
    const massing = Object.values(ctx.store.state.tasks).find((task) => task.projectId === ctx.harbour && task.templatePartId === 't1')!;
    ctx.store.state.tasks[massing.id].title = 'Massing (team)';
    await ctx.api.call('projectTemplates.save', { ...TEMPLATE, id: ctx.templateId, tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] } as never);
    await openSheet(ctx);
    const review = await reachReview();
    const edited = await within(review).findByRole('region', { name: 'Edited by the team' });
    expect(within(edited).getByRole('checkbox')).not.toBeChecked();
    expect(within(edited).getByText(/Massing \(team\): the template has the title Massing study v2/)).toBeInTheDocument();
    // Lake House has the plain change, Harbour Offices only the edited one.
    expect(within(review).getByRole('region', { name: 'Titles and descriptions' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Update/ }));
    expect(await screen.findByText(/^Updated 1 project\.$/)).toBeInTheDocument();
    expect(ctx.store.state.tasks[massing.id].title).toBe('Massing (team)');
  });

  it('takes the template for an edited task when the Admin ticks it', async () => {
    const ctx = await setUp();
    const massing = Object.values(ctx.store.state.tasks).find((task) => task.projectId === ctx.harbour && task.templatePartId === 't1')!;
    ctx.store.state.tasks[massing.id].title = 'Massing (team)';
    await ctx.api.call('projectTemplates.save', { ...TEMPLATE, id: ctx.templateId, tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] } as never);
    await openSheet(ctx);
    const review = await reachReview();
    await userEvent.click(within(await within(review).findByRole('region', { name: 'Edited by the team' })).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByText('Updated 2 projects.')).toBeInTheDocument();
    expect(ctx.store.state.tasks[massing.id].title).toBe('Massing study v2');
  });

  it('stops at the project that fails, and the toast has an Undo that takes back the projects that changed', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    const original = ctx.api.run.bind(ctx.api);
    let applied = 0;
    vi.spyOn(ctx.api, 'run').mockImplementation(((name: string, input: unknown, meta?: unknown) => {
      if (name === 'projectTemplates.syncApply' && (applied += 1) === 2) return Promise.reject(new Error('The call failed.'));
      return original(name as never, input as never, meta as never);
    }) as never);
    await openSheet(ctx);
    await reachReview();
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByText('The update stopped. The projects before it stay changed.')).toBeInTheDocument();
    expect(sitePhotos(ctx).map((task) => task.projectId)).toEqual([ctx.harbour]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sitePhotos(ctx)).toHaveLength(0));
  });

  it('links a project that is not linked, from the same sheet', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'Link Office refit' }));
    expect(await screen.findByRole('dialog', { name: /^Link Office refit to Villa/ })).toBeInTheDocument();
  });

  it('opens at the review with every linked project ticked after "Update them"', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    await openSheet(ctx, true);
    const review = await screen.findByRole('dialog', { name: 'Review the changes' });
    expect(await within(review).findByRole('region', { name: 'New items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update 2 projects' })).toBeEnabled();
  });

  it('ticks at most 50 of 51 linked projects, and the review still opens', async () => {
    const ctx = await setUp();
    // The 49 projects come before the template gets its new task, so each of the 51 projects lacks "Site photos".
    for (let n = 1; n <= 49; n += 1) {
      await ctx.api.call('projects.create', { name: `Villa ${n}`, template: { templateId: ctx.templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    }
    await addSitePhotos(ctx);
    await openSheet(ctx);
    const linked = within(screen.getByRole('region', { name: 'Linked projects' }));
    const ticked = () => linked.getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked);
    expect(linked.getAllByRole('checkbox')).toHaveLength(51);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(ticked()).toHaveLength(50);
    expect(screen.getByText('You can update 50 projects at one time. Update the rest in a second round.')).toBeInTheDocument();
    await userEvent.click(linked.getAllByRole('checkbox').find((box) => !(box as HTMLInputElement).checked)!);
    expect(ticked()).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'Review the changes' }));
    expect(await screen.findByText('50 items in 50 projects')).toBeInTheDocument();
  });

  it('shows a paused project as stale when the pause is older than the office allows', async () => {
    const ctx = await setUp();
    // The pause began 40 days before the test day. The office allows 30 days.
    const lake = ctx.store.state.projects[ctx.lake];
    lake.status = 'on_hold';
    lake.pause = { reason: 'Waiting for the client', resumeOn: null, by: 'usr_001', at: '2026-08-21T09:00:00.000+03:00' };
    await openSheet(ctx);
    expect(within(screen.getByRole('region', { name: 'Linked projects' })).getByText('Stale · paused 40 days')).toBeInTheDocument();
  });

  it('Cancel at the pick step and at the review sends nothing', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    const picked = await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(picked.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const reviewed = await openSheet(ctx);
    await reachReview();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(reviewed.onClose).toHaveBeenCalledTimes(1);
    expect(sitePhotos(ctx)).toHaveLength(0);
  });
});
