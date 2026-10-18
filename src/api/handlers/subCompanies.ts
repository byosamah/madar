import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { SubCompany, SubCompanyId } from '../contract/entities';
import { ApiError, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { nextId, subCompaniesOf } from '../store';
import { assertCan } from './shared';

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
  output: z.array(SubCompany),
  readOnly: true,
  run(_input, ctx) {
    return Object.values(subCompaniesOf(ctx.state)).sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** No id makes a sub-company. An id changes it. Only the Admin saves. */
const subCompaniesSave = defineCall({
  input: z.object({ id: SubCompanyId.optional(), name: SubCompanyText, nameAr: SubCompanyText, logo: Logo }),
  output: SubCompany,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
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
    applyPatch(ctx, sub, { name: input.name, nameAr: input.nameAr, logo: input.logo }, { projectId: null, verb: 'subCompany.updated', targetType: 'subCompany', targetId: sub.id });
    return sub;
  },
});

/** The delete refuses a sub-company that a project names. The Undo toast brings a deleted one back. */
const subCompaniesDelete = defineCall({
  input: z.object({ id: SubCompanyId }),
  output: z.object({}),
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const sub = requireSubCompany(ctx, input.id);
    const naming = Object.values(ctx.state.projects).filter((project) => project.subCompanyId === sub.id).length;
    if (naming > 0) throw new ApiError('conflict', 'A project uses this sub-company. Change the project first.', { reason: 'sub_company_in_use', count: naming });
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
