import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { SubCompany, SubCompanyId } from '../contract/entities';
import { ApiError, forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { projectViewer } from '../projectView';
import { nextId, subCompaniesOf } from '../store';
import { assertCan, seesProject, touch } from './shared';

const SubCompanyText = z.string().trim().min(1).max(80);
const Logo = SubCompany.shape.logo;

function requireSubCompany(ctx: Ctx, id: string): SubCompany {
  const sub = subCompaniesOf(ctx.state)[id];
  if (!sub) throw notFound('Sub-company', id);
  return sub;
}

/** A name is unique in each language, ignoring case. A name of one language never equals a name of another sub-company. */
function assertNamesFree(ctx: Ctx, names: { name: string; nameAr: string }, exceptId: string | null): void {
  const others = Object.values(subCompaniesOf(ctx.state)).filter((sub) => sub.id !== exceptId);
  const taken = (value: string) => {
    const key = value.toLowerCase();
    return others.some((sub) => sub.name.toLowerCase() === key || sub.nameAr.toLowerCase() === key);
  };
  if (taken(names.name)) throw invalid('name', 'A sub-company with this name exists. Use another name.', 'duplicate_name');
  if (taken(names.nameAr)) throw invalid('nameAr', 'A sub-company with this name exists. Use another name.', 'duplicate_name');
}

/** Everyone reads the sub-companies: the project form, the project tiles and the logo of a project need the names and logos. */
const subCompaniesList = defineCall({
  input: z.object({}),
  // projectCount: the projects of any status that name the sub-company, for the Admin list (PRJ-12). Optional, so an older answer parses.
  output: z.array(SubCompany.extend({ projectCount: z.number().int().min(0).optional() })),
  readOnly: true,
  run(_input, ctx) {
    const counts = new Map<string, number>();
    // The number counts the projects that the person sees (hidden projects, owner 2026-10-22).
    const sees = projectViewer(ctx.state, ctx.authority);
    for (const project of Object.values(ctx.state.projects)) {
      if (project.subCompanyId && sees(project)) counts.set(project.subCompanyId, (counts.get(project.subCompanyId) ?? 0) + 1);
    }
    return Object.values(subCompaniesOf(ctx.state))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sub) => ({ ...sub, projectCount: counts.get(sub.id) ?? 0 }));
  },
});

/** No id makes a sub-company. An id changes it. Only the Admin, or a role with subCompanies.manage, saves. */
const subCompaniesSave = defineCall({
  input: z.object({ id: SubCompanyId.optional(), name: SubCompanyText, nameAr: SubCompanyText, logo: Logo }),
  output: SubCompany,
  run(input, ctx) {
    assertCan(ctx, 'subCompanies.manage');
    // A logo is picture data (WebP, JPEG or PNG, 24,000 characters at most; the Logo schema checks it). An agent may set one (owner, 2026-10-26:
    // uploads include pictures), but it never clears one: it sends logo null to keep the old logo, and a rename then loses nothing.
    if (input.id === undefined) {
      assertNamesFree(ctx, input, null);
      const id = nextId(ctx.state, 'sub');
      const sub: SubCompany = { id, name: input.name, nameAr: input.nameAr, logo: input.logo, createdBy: ctx.authority.id, createdAt: ctx.stamp };
      subCompaniesOf(ctx.state)[id] = sub;
      recordCreate(ctx, { projectId: null, verb: 'subCompany.created', targetType: 'subCompany', targetId: id, entity: sub });
      return sub;
    }
    const sub = requireSubCompany(ctx, input.id);
    assertNamesFree(ctx, input, sub.id);
    applyPatch(ctx, sub, { name: input.name, nameAr: input.nameAr, logo: ctx.actor.kind === 'agent' ? (input.logo ?? sub.logo) : input.logo }, { projectId: null, verb: 'subCompany.updated', targetType: 'subCompany', targetId: sub.id });
    return sub;
  },
});

/**
 * The delete refuses a sub-company that a project names, unless the call says where the projects go (moveToId: another
 * sub-company, or null for none). Then the projects move first and the sub-company goes, all in one story, so one Undo brings
 * everything back (PRJ-12). The Undo toast brings a deleted one back.
 */
const subCompaniesDelete = defineCall({
  input: z.object({ id: SubCompanyId, moveToId: SubCompanyId.nullable().optional() }),
  output: z.object({}),
  run(input, ctx) {
    assertCan(ctx, 'subCompanies.manage');
    const sub = requireSubCompany(ctx, input.id);
    const naming = Object.values(ctx.state.projects).filter((project) => project.subCompanyId === sub.id);
    if (input.moveToId === sub.id) throw invalid('moveToId', 'Choose another sub-company to move the projects to.');
    if (naming.length > 0 && input.moveToId === undefined) {
      // The count is the projects the person sees (hidden projects, owner 2026-10-22). A person who sees none of them, while a hidden one
      // still names the sub-company, is refused with no count: only a holder of "See hidden projects" deletes then.
      const seen = naming.filter((project) => seesProject(ctx, project.id)).length;
      if (seen === 0) throw forbidden('You cannot do this.', { action: 'project.hidden' });
      throw new ApiError('conflict', 'A project uses this sub-company. Change the project first.', { reason: 'sub_company_in_use', count: seen });
    }
    if (input.moveToId !== undefined) {
      if (input.moveToId !== null) requireSubCompany(ctx, input.moveToId);
      for (const project of naming) {
        applyPatch(ctx, project, { subCompanyId: input.moveToId }, { projectId: project.id, verb: 'project.updated', targetType: 'project', targetId: project.id });
        touch(ctx, project.id);
      }
    }
    delete subCompaniesOf(ctx.state)[sub.id];
    recordDelete(ctx, { projectId: null, verb: 'subCompany.deleted', targetType: 'subCompany', targetId: sub.id, entity: sub });
    return {};
  },
});

export const subCompanyCalls = {
  'subCompanies.list': subCompaniesList,
  'subCompanies.save': subCompaniesSave,
  'subCompanies.delete': subCompaniesDelete,
};
