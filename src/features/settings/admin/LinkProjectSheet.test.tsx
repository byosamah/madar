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
import { LinkProjectSheet } from './LinkProjectSheet';

/**
 * "Link <project> to <template>" (fbk_008 item 4; ADM-11). The sample office holds "Villa, full design": stages Concept, Schematic Design,
 * Design Development, Construction Documents and Permits, and tasks t1 "Site visit and survey" (Concept) to t11. The test project
 * has the stages Concept, Schematic Design and Permits, and two tasks: "Site visit and survey" and "Balady submission pack".
 */
async function setUp() {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0, sampleOffice });
  initI18n('en');
  const plan = Object.values(state.projectTemplates!).find((template) => template.name === 'Villa, full design') as ProjectTemplate;
  const { project } = await api.call('projects.create', { name: 'Harbour Offices', stages: ['Concept', 'Schematic Design', 'Permits'] });
  const stageNamed = (name: string) => Object.values(store.state.stages).find((stage) => stage.projectId === project.id && stage.name === name)!.id;
  const survey = await api.call('tasks.create', { projectId: project.id, stageId: stageNamed('Concept'), title: 'Site visit and survey', ownerId: 'usr_001' });
  const pack = await api.call('tasks.create', { projectId: project.id, stageId: stageNamed('Permits'), title: 'Balady submission pack', ownerId: 'usr_001' });
  return { api, store, plan, projectId: project.id, stageNamed, surveyId: survey.task.id, packId: pack.task.id };
}

/** The sheet with the app providers. A close (the Cancel button or a saved link) takes it off the screen, as a screen does. */
function Host({ projectId, template, onClose }: { projectId: string; template: ProjectTemplate; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <LinkProjectSheet projectId={projectId} template={template} onClose={() => { setOpen(false); onClose(); }} />;
}

async function openSheet(ctx: Awaited<ReturnType<typeof setUp>>, onClose = vi.fn()) {
  const queryClient = createQueryClient();
  render(
    <RuntimeProvider runtime={{ store: ctx.store, api: ctx.api }} queryClient={queryClient}>
      <ToastProvider>
        <Host projectId={ctx.projectId} template={ctx.plan} onClose={onClose} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  // The sheet shows the matches once the names are read. The matched parts sit under a fold: open it, then read the first pick.
  await userEvent.click(await screen.findByText(/^Matched · /));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Project item for Concept' })).toHaveValue(ctx.stageNamed('Concept')));
  return { onClose };
}

describe('Link an older project', () => {
  it('names the project and the template, says how many parts match, and shows the parts with no match first (ADM-11)', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    expect(screen.getByRole('dialog', { name: 'Link Harbour Offices to Villa, full design' })).toBeInTheDocument();
    expect(screen.getByText('3 of 5 stages and 2 of 11 tasks match.')).toBeInTheDocument();
    const none = screen.getByRole('region', { name: 'No match yet · 11' });
    expect(within(none).getByRole('combobox', { name: 'Project item for Design Development' })).toBeInTheDocument();
    expect(within(none).queryByRole('combobox', { name: 'Project item for Concept' })).not.toBeInTheDocument();
    // "Leave them out" is the start choice: an older project keeps its own plan.
    expect(within(none).getByRole('radio', { name: /^Leave them out/ })).toBeChecked();
  });

  it('groups the tasks of the project by their stage, so two tasks of one name look different', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    const pick = screen.getByRole('combobox', { name: 'Project item for Balady submission pack' });
    const groups = Array.from(pick.querySelectorAll('optgroup')).map((group) => group.label);
    expect(groups).toEqual(['Concept', 'Permits']);
    expect(within(pick.querySelector('optgroup[label="Permits"]') as HTMLElement).getByRole('option', { name: 'Balady submission pack' })).toBeInTheDocument();
  });

  it('adds the parts with no match to the project at once when the Admin picks "Add them", and one Undo takes it all back', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    await userEvent.click(screen.getByRole('radio', { name: /^Add them to the project/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(await screen.findByText('The project is linked to the template.')).toBeInTheDocument();
    const mine = (partId: string) => Object.values(ctx.store.state.tasks).some((task) => task.projectId === ctx.projectId && task.templatePartId === partId);
    await waitFor(() => expect(mine('t2')).toBe(true));
    expect(ctx.store.state.projects[ctx.projectId].templateLink!.droppedPartIds).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(ctx.store.state.projects[ctx.projectId].templateLink).toBeFalsy());
    expect(mine('t2')).toBe(false);
  });

  it('fills each pick with the item of the project that has the same name', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    expect(screen.getByRole('combobox', { name: 'Project item for Schematic Design' })).toHaveValue(ctx.stageNamed('Schematic Design'));
    expect(screen.getByRole('combobox', { name: 'Project item for Site visit and survey' })).toHaveValue(ctx.surveyId);
    expect(screen.getByRole('combobox', { name: 'Project item for Balady submission pack' })).toHaveValue(ctx.packId);
  });

  it('leaves a part with no match on "No match"', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    expect(screen.getByRole('combobox', { name: 'Project item for Design Development' })).toHaveValue('');
    expect(within(screen.getByRole('combobox', { name: 'Project item for Design Development' })).getByRole('option', { name: 'No match' })).toBeInTheDocument();
  });

  it('offers an item to one part only: the item that another part holds is not in its list', async () => {
    const ctx = await setUp();
    await openSheet(ctx);
    const schematic = screen.getByRole('combobox', { name: 'Project item for Schematic Design' });
    expect(within(schematic).queryByRole('option', { name: 'Concept' })).not.toBeInTheDocument();
    expect(within(schematic).getByRole('option', { name: 'Schematic Design' })).toBeInTheDocument();
  });

  it('saves the link with the picks, drops the parts with no match, and closes', async () => {
    const ctx = await setUp();
    const { onClose } = await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(await screen.findByText('The project is linked to the template.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: /^Link Harbour Offices/ })).not.toBeInTheDocument();
    const link = ctx.store.state.projects[ctx.projectId].templateLink!;
    expect(link.templateId).toBe(ctx.plan.id);
    expect(link.droppedPartIds).toEqual(expect.arrayContaining(['s3', 's4', 't2']));
    expect(link.droppedPartIds).not.toContain('s1');
    expect(link.droppedPartIds).not.toContain('t10');
  });

  it('sends nothing before Save link, and nothing on Cancel', async () => {
    const ctx = await setUp();
    const { onClose } = await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ctx.store.state.projects[ctx.projectId].templateLink).toBeFalsy();
  });

  it('shows the refusal and keeps the sheet open when the project has a link already', async () => {
    const ctx = await setUp();
    await ctx.api.call('projectTemplates.link', { projectId: ctx.projectId, templateId: ctx.plan.id, stageMatches: {}, taskMatches: {}, rolePeople: {} });
    await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(await screen.findByText('This project is already linked to a template.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /^Link Harbour Offices/ })).toBeInTheDocument();
  });

  it('links a role with no person when its default person is no longer active, and does not refuse the link', async () => {
    const ctx = await setUp();
    const architect = ctx.plan.roles.find((role) => role.id === 'r1')!;
    ctx.store.state.users[architect.defaultUserId!].active = false;
    const { onClose } = await openSheet(ctx);
    await userEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(await screen.findByText('The project is linked to the template.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ctx.store.state.projects[ctx.projectId].templateLink!.rolePeople[architect.id]).toBeNull();
  });

  it('shows the failed load of the people, and keeps Save link off', async () => {
    const ctx = await setUp();
    const original = ctx.api.call.bind(ctx.api);
    vi.spyOn(ctx.api, 'call').mockImplementation(async (...args: Parameters<typeof ctx.api.call>) => {
      if (args[0] === 'users.list') throw new Error('The people did not load.');
      return original(...args);
    });
    await openSheet(ctx);
    expect(await screen.findByText('The data did not load.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save link' })).toBeDisabled();
  });
});
