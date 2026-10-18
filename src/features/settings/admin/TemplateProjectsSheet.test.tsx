import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
 * "Projects using this template" (fbk_008 item 4). The template "Villa" has two stages, Concept and Permits, and two tasks. Two
 * projects are linked to it, "Harbour Offices" and "Lake House", and "Office refit" is open and not linked.
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
function Host({ template, onClose }: { template: ProjectTemplate; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <TemplateProjectsSheet template={template} onClose={() => { setOpen(false); onClose(); }} />;
}

async function openSheet(ctx: Ctx) {
  const onClose = vi.fn();
  render(
    <RuntimeProvider runtime={{ store: ctx.store, api: ctx.api }} queryClient={createQueryClient()}>
      <ToastProvider>
        <Host template={ctx.template} onClose={onClose} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  await screen.findByRole('region', { name: 'Linked projects' });
  return { onClose };
}

/** Picks every linked project, asks the update, and goes through the cards and the summary to the last confirm. */
async function reachConfirm() {
  await userEvent.click(screen.getByRole('button', { name: 'All' }));
  await userEvent.click(screen.getByRole('button', { name: 'Update projects' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
  return screen.findByRole('dialog', { name: 'Start the update?' });
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

  it('ticks every linked project with All, clears them with None, and needs one pick before the update', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    expect(screen.getByRole('button', { name: 'Update projects' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('checkbox', { name: /Harbour Offices/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Lake House/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Update projects' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(screen.getByRole('checkbox', { name: /Lake House/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Update projects' })).toBeDisabled();
  });

  it('asks first, shows each change, and sends nothing before the last confirm', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.click(screen.getByRole('button', { name: 'Update projects' }));
    expect(await screen.findByRole('dialog', { name: 'Update 2 projects with the changes of this template?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('dialog', { name: 'Choose each change' })).toBeInTheDocument();
    expect(screen.getByText('New items')).toBeInTheDocument();
    expect(screen.getByText('2 items in 2 projects')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Make the change' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Check each project' })).toBeInTheDocument();
    expect(screen.getByText('Harbour Offices')).toBeInTheDocument();
    expect(sitePhotos(ctx)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Start the update?' })).toBeInTheDocument();
    expect(sitePhotos(ctx)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByRole('dialog', { name: 'Updated 2 projects.' })).toBeInTheDocument();
    expect(sitePhotos(ctx).map((task) => task.projectId).sort()).toEqual([ctx.harbour, ctx.lake].sort());
  });

  it('Undo all takes back the changes of every project in one update', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    await openSheet(ctx);
    await reachConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByRole('dialog', { name: 'Updated 2 projects.' })).toBeInTheDocument();
    expect(sitePhotos(ctx)).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Undo all' }));
    expect(await screen.findByText('The update is undone.')).toBeInTheDocument();
    await waitFor(() => expect(sitePhotos(ctx)).toHaveLength(0));
  });

  it('Cancel at the last step sends nothing', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    const { onClose } = await openSheet(ctx);
    await reachConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sitePhotos(ctx)).toHaveLength(0);
  });

  it('starts the focus on Back at the last confirm, so a stray Enter sends nothing', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    await openSheet(ctx);
    await reachConfirm();
    expect(screen.getByRole('button', { name: 'Update 2 projects' })).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(sitePhotos(ctx)).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'Updated 2 projects.' })).not.toBeInTheDocument();
  });

  it('asks one reason when a date moves, before the last confirm', async () => {
    const ctx = await setUp();
    await longerPermits(ctx);
    const before = permitsDue(ctx, ctx.harbour);
    await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.click(screen.getByRole('button', { name: 'Update projects' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('dialog', { name: 'Choose each change' })).toBeInTheDocument();
    expect(screen.getByText('Planned dates')).toBeInTheDocument();
    expect(screen.getByText('2 tasks in 2 projects')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Check each project' })).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /Reason for the new dates/ }), 'The client asked for a longer permit review.');
    expect(next).toBeEnabled();
    await userEvent.click(next);
    await userEvent.click(await screen.findByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByRole('dialog', { name: 'Updated 2 projects.' })).toBeInTheDocument();
    expect(permitsDue(ctx, ctx.harbour)).not.toBe(before);
  });

  it('stops at the project that fails, and Undo all takes back the projects that changed', async () => {
    const ctx = await setUp();
    await addSitePhotos(ctx);
    const original = ctx.api.run.bind(ctx.api);
    let applied = 0;
    vi.spyOn(ctx.api, 'run').mockImplementation(((name: string, input: unknown, meta?: unknown) => {
      if (name === 'projectTemplates.syncApply' && (applied += 1) === 2) return Promise.reject(new Error('The call failed.'));
      return original(name as never, input as never, meta as never);
    }) as never);
    await openSheet(ctx);
    await reachConfirm();
    await userEvent.click(screen.getByRole('button', { name: 'Update 2 projects' }));
    expect(await screen.findByRole('dialog', { name: 'The update stopped.' })).toBeInTheDocument();
    expect(sitePhotos(ctx).map((task) => task.projectId)).toEqual([ctx.harbour]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo all' }));
    await waitFor(() => expect(sitePhotos(ctx)).toHaveLength(0));
  });

  it('links a project that is not linked, from the same sheet', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'Link Office refit' }));
    expect(await screen.findByRole('dialog', { name: 'Link an older project' })).toBeInTheDocument();
  });

  it('ticks at most 50 of 51 linked projects, and the update still reaches the first change step', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Update projects' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('dialog', { name: 'Choose each change' })).toBeInTheDocument();
    expect(screen.getByText('50 items in 50 projects')).toBeInTheDocument();
  });
});
