import { z } from 'zod';
import { User, type Gender, type Language, type RoleSettings } from '../../src/api/contract/entities';
import { ApiError, forbidden } from '../../src/api/errors';
import { inOrder, offInOrder } from '../../src/api/handlers/roles';
import { heldRightsOfRole } from '../../src/api/rights';
import ar from '../../src/i18n/real/mcpguard.ar.json';
import en from '../../src/i18n/real/mcpguard.en.json';
import { escapeHtml, fill, page, pick } from '../auth/mail';
import { registerEffect } from '../core/effects';
import type { Deps } from '../core/ports';
import type { CallData, CallTx } from '../core/runCall';
import type { OfficeSnapshot, Principal } from '../core/types';
import { sqlFor } from '../data/dialect';
import { brandHeader, logoAddress } from '../mail/templates/layout';
import { mailWords } from '../mail/templates/words';
import { QuotaFull, sendCounted } from '../mail/quota';
import {
  CODE_TTL_MS, HOUR_MS, MAX_NEW_PER_HOUR, MAX_TRIES, codeHashOf, newCode, newConfirmId, sameHash, sqlConfirms, type ConfirmStore,
} from './confirms';
import { CONFIRM_FIELD, GUARDED_CALLS } from './guardCalls';

export { CONFIRM_FIELD, GUARDED_CALLS };

/**
 * The email code guard (owner decision, 2026-10-26, after a security review). An agent that was tricked (prompt injection) must not
 * invite an outsider, make an Admin, change the role of a person or the rights of a role, and so take over the office. Madar already
 * refuses an agent an email change for the same reason. So for these acts, when the ACTOR is an agent, Madar asks the PERSON of the agent
 * for a code by email (the person, never the agent and never another address):
 *
 *   users.create (every invitation), users.update when systemRole or roleId would change, users.deactivate, users.reactivate,
 *   users.remove, roles.create, roles.update and roles.delete.
 *
 * The guard sits in runCall (core/runCall.ts), so no route skips it: the Pages Function, the mcp function, the Worker and the office object
 * all run their calls there. A person in the screens is no agent and needs no code.
 *
 *   1. The first call has no confirmCode. The handler runs first (so a refusal of the rights, a bad field or a missing record still
 *      answers as before, and no mail goes for a call that would fail). Then the transaction stops BEFORE the save, and nothing changes.
 *      Madar records one confirmation (confirms.ts) and writes one mail row to the outbox in a transaction of its own, then runs the mail.
 *      The call fails with forbidden and the reason confirm_needed.
 *   2. The second call has the same arguments and confirmCode. First, in a transaction of its own and BEFORE the compare, the call counts
 *      one try on the live row (tryCode: one statement, so parallel guesses cannot pass 5). The row is the one of the same person, agent,
 *      call and hash of the input, not used, not expired, with fewer than 5 tries. Then the code hash is compared. A right code claims the
 *      row inside the transaction of the act (requireCode), after the handler ran, so a failed act keeps the code, and two calls with one
 *      code never both run.
 *   3. A wrong code has its try counted already. The fifth try kills the row: the sixth call fails even with the right code. A right code
 *      uses one try too (the tries include the right one). A call that carries a code counts one try also when its act then fails.
 *
 * The code is in the mail and in the outbox row until the mail goes (the effect removes it, as the invitation removes its token), never
 * in an answer, a log line or an event. The table keeps a hash only.
 */

export const CONFIRM_KIND = 'mcp.confirm';

/** True for a call that needs the code: the actor is an agent and the call is on the list. */
export function guardApplies(name: string, principal: Principal): boolean {
  return principal.agent !== undefined && GUARDED_CALLS.has(name);
}

/** The input without the code, and the code. The code is no part of the input: the hash and the handler never see it. */
export function takeCode(input: unknown): { input: unknown; code?: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || !(CONFIRM_FIELD in input)) return { input };
  const { [CONFIRM_FIELD]: code, ...rest } = input as Record<string, unknown>;
  return { input: rest, ...(typeof code === 'string' ? { code } : {}) };
}

type ActKey = 'usersCreate' | 'usersRole' | 'usersDeactivate' | 'usersReactivate' | 'usersRemove' | 'rolesCreate' | 'rolesUpdate' | 'rolesDelete';
type RoleLabel = { kind: 'system'; id: 'admin' | 'management' | 'accounting' | 'member' } | { kind: 'custom'; name: string; nameAr: string };
/** A capped list for the mail: at most LIST_MAX items, and the count of the rest ("and N more"). */
export type Listed = { items: string[]; more: number };
/**
 * What the mail says: one act, its target (a name in both languages), and for an invitation or a role change the role. The role acts say
 * more (fix of 2026-10-26, so the person sees what the code allows):
 * - users.update: `from`, the role before (`role` is the role after).
 * - roles.create: `added` the rights it gives, `removed` the basic rights it turns off.
 * - roles.update: `added` and `removed` against the stored role (the rights it holds after the change against before), and the new names.
 * - roles.delete: `moveTo`, the role that takes the people of the deleted role.
 */
export type GuardAct = {
  key: ActKey; target: { name: string; nameAr: string }; detail?: string; role?: RoleLabel; from?: RoleLabel;
  added?: Listed; removed?: Listed; newName?: string; newNameAr?: string; moveTo?: RoleLabel;
};

type Input = Record<string, unknown>;
const BUILT_IN_ROLES = ['admin', 'management', 'accounting', 'member'] as const;

/** A text from a person or an agent goes into a mail: no control character, no direction mark, one line, 60 characters at most. */
export function cleanText(text: string, max = 60): string {
  return text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The most items of a list in the mail. */
const LIST_MAX = 8;

/** A list of right ids for the mail: each id cleaned, the first LIST_MAX kept, the rest counted. Undefined for an empty list. */
function listed(items: readonly string[]): Listed | undefined {
  if (items.length === 0) return undefined;
  return { items: items.slice(0, LIST_MAX).map((item) => cleanText(item, 40)), more: Math.max(0, items.length - LIST_MAX) };
}

const without = (items: readonly string[], drop: readonly string[]) => items.filter((item) => !drop.includes(item));

const nameOf = (user: Pick<User, 'name' | 'nameAr'> | undefined, fallback: string) => ({
  name: cleanText(user?.name ?? fallback), nameAr: cleanText(user?.nameAr || user?.name || fallback),
});

function roleLabel(office: OfficeSnapshot, systemRole: string, roleId: string | null | undefined): RoleLabel {
  const custom = systemRole === 'member' && roleId ? office.lists.settings.roles?.custom?.find((role) => role.id === roleId) : undefined;
  if (custom) return { kind: 'custom', name: cleanText(custom.name), nameAr: cleanText(custom.nameAr) };
  return { kind: 'system', id: (BUILT_IN_ROLES as readonly string[]).includes(systemRole) ? (systemRole as 'admin') : 'member' };
}

/**
 * The act that needs a code, or undefined when the call needs none. It runs on the PARSED input and the office, after the handler passed, so
 * the record exists and the rights are right. users.update asks only when systemRole or roleId would change against the stored value.
 */
export function guardAct(name: string, parsed: unknown, office: OfficeSnapshot): GuardAct | undefined {
  const input = parsed as Input;
  const users = office.lists.users;
  switch (name) {
    case 'users.create': {
      const systemRole = String(input.systemRole ?? 'member');
      return {
        key: 'usersCreate', target: nameOf({ name: String(input.name ?? ''), nameAr: typeof input.nameAr === 'string' ? input.nameAr : undefined }, ''),
        detail: cleanText(String(input.email ?? ''), 80), role: roleLabel(office, systemRole, typeof input.roleId === 'string' ? input.roleId : null),
      };
    }
    case 'users.update': {
      const stored = users[String(input.id)];
      const patch = (input.patch ?? {}) as Input;
      if (!stored) return undefined;
      const systemRoleChanged = typeof patch.systemRole === 'string' && patch.systemRole !== stored.systemRole;
      const roleIdChanged = patch.roleId !== undefined && patch.roleId !== (stored.roleId ?? null);
      if (!systemRoleChanged && !roleIdChanged) return undefined;
      const nextSystem = typeof patch.systemRole === 'string' ? patch.systemRole : stored.systemRole;
      const nextRoleId = patch.roleId !== undefined ? (patch.roleId as string | null) : stored.roleId;
      return {
        key: 'usersRole', target: nameOf(stored, String(input.id)), role: roleLabel(office, nextSystem, nextRoleId), from: roleLabel(office, stored.systemRole, stored.roleId),
      };
    }
    case 'users.deactivate':
      return { key: 'usersDeactivate', target: nameOf(users[String(input.id)], String(input.id)) };
    case 'users.reactivate':
      return { key: 'usersReactivate', target: nameOf(users[String(input.id)], String(input.id)) };
    case 'users.remove':
      return { key: 'usersRemove', target: nameOf(users[String(input.id)], String(input.id)) };
    case 'roles.create': {
      const added = listed(inOrder((input.rights as string[] | undefined) ?? []));
      const removed = listed(offInOrder((input.off as string[] | undefined) ?? []));
      return {
        key: 'rolesCreate', target: { name: cleanText(String(input.name ?? '')), nameAr: cleanText(String(input.nameAr ?? input.name ?? '')) },
        ...(added ? { added } : {}), ...(removed ? { removed } : {}),
      };
    }
    case 'roles.update': {
      const id = String(input.role);
      const settings = office.lists.settings.roles;
      const custom = settings?.custom?.find((role) => role.id === id);
      const label = custom ? { name: cleanText(custom.name), nameAr: cleanText(custom.nameAr) } : { name: cleanText(id), nameAr: cleanText(id) };
      const builtIn = (BUILT_IN_ROLES as readonly string[]).includes(id);
      const rights = input.rights !== undefined ? inOrder(input.rights as string[]) : undefined;
      const off = input.off !== undefined ? offInOrder(input.off as string[]) : undefined;
      // The rights that the role holds before and after, as the role sheet counts them (basic switches, the turned-off ones, the extra ones).
      let before: readonly string[] = [];
      let after: readonly string[] = [];
      if (builtIn) {
        const role = id as 'member';
        const next: RoleSettings = {
          ...(settings ?? {}),
          ...(rights !== undefined ? { rights: { ...(settings?.rights ?? {}), [role]: rights } } : {}),
          ...(off !== undefined ? { off: { ...(settings?.off ?? {}), [role]: off } } : {}),
        };
        before = heldRightsOfRole(settings, role);
        after = heldRightsOfRole(next, role);
      } else if (custom) {
        before = heldRightsOfRole(settings, custom);
        after = heldRightsOfRole(settings, { ...custom, ...(rights !== undefined ? { rights } : {}), ...(off !== undefined ? { off } : {}) });
      }
      const added = listed(without(after, before));
      const removed = listed(without(before, after));
      const newName = custom && typeof input.name === 'string' && input.name !== custom.name ? cleanText(input.name) : undefined;
      const newNameAr = custom && typeof input.nameAr === 'string' && input.nameAr !== custom.nameAr ? cleanText(input.nameAr) : undefined;
      return {
        key: 'rolesUpdate', target: label, ...(builtIn ? { role: { kind: 'system' as const, id: id as 'member' } } : {}),
        ...(added ? { added } : {}), ...(removed ? { removed } : {}), ...(newName ? { newName } : {}), ...(newNameAr ? { newNameAr } : {}),
      };
    }
    case 'roles.delete': {
      const custom = office.lists.settings.roles?.custom?.find((role) => role.id === String(input.id));
      const moveTo = typeof input.moveTo === 'string' ? input.moveTo : undefined;
      return {
        key: 'rolesDelete',
        target: custom ? { name: cleanText(custom.name), nameAr: cleanText(custom.nameAr) } : { name: cleanText(String(input.id)), nameAr: cleanText(String(input.id)) },
        ...(moveTo ? { moveTo: (BUILT_IN_ROLES as readonly string[]).includes(moveTo) ? roleLabel(office, moveTo, null) : roleLabel(office, 'member', moveTo) } : {}),
      };
    }
    default:
      return undefined;
  }
}

/** Why the act stopped. runCall throws it inside the transaction, which rolls back, and then answers from it. */
export type Stop =
  | { kind: 'needed'; personId: string; agentId: string; agent: string; call: string; inputHash: string; act: GuardAct }
  | { kind: 'wrong' }
  | { kind: 'invalid' };

/** What the count and the compare of a code found (tryCode). right: the row that the act claims. */
export type TriedCode = { kind: 'right'; id: string } | { kind: 'wrong' } | { kind: 'dead' };

export class GuardStop extends Error {
  readonly stop: Stop;

  constructor(stop: Stop) {
    super('The act waits for a code.');
    this.name = 'GuardStop';
    this.stop = stop;
  }
}

const storeOf = (t: CallTx): ConfirmStore => t.confirms ?? sqlConfirms(t.q);

/**
 * Before the transaction of the act (and before the lock): counts one try on the live row in a transaction of its own, which commits, and
 * only then compares the code. The count is one statement with the live test inside (confirms.ts), so ten parallel guesses count five
 * tries and the other five meet a dead row. The compare needs no lock. The answer is used by requireCode, inside the act.
 */
export async function tryCode(data: CallData, o: { personId: string; agentId: string; call: string; inputHash: string; code: string; now: Date }): Promise<TriedCode> {
  const counted = await data.tx('write', async (t) => storeOf(t).count({ personId: o.personId, agentId: o.agentId, call: o.call, inputHash: o.inputHash, now: o.now }));
  if (!counted) return { kind: 'dead' };
  return sameHash(counted.codeHash, await codeHashOf(counted.id, o.code)) ? { kind: 'right', id: counted.id } : { kind: 'wrong' };
}

/**
 * Inside the transaction of the act, after the handler passed and before the save. `tried` is the answer of tryCode, or undefined when the
 * call carried no code. Returns when the code is right and claimed. Throws GuardStop otherwise; the transaction then rolls back, so the
 * claim of a failed act is undone.
 */
export async function requireCode(t: CallTx, o: {
  personId: string; agentId: string; agent: string; call: string; inputHash: string; act: GuardAct; tried: TriedCode | undefined; now: Date;
}): Promise<void> {
  const { tried } = o;
  if (tried === undefined) throw new GuardStop({ kind: 'needed', personId: o.personId, agentId: o.agentId, agent: o.agent, call: o.call, inputHash: o.inputHash, act: o.act });
  if (tried.kind === 'dead') throw new GuardStop({ kind: 'invalid' });
  if (tried.kind === 'wrong') throw new GuardStop({ kind: 'wrong' });
  if (!(await storeOf(t).claim(tried.id, o.now))) throw new GuardStop({ kind: 'invalid' });
}

const MINUTES = CODE_TTL_MS / 60_000;
const NEEDED = 'Your person must confirm this act with a code. Madar sent a 6-digit code to your person by email. Ask your person for the code. Then call this tool again with the same arguments and confirmCode. The code works one time, for 10 minutes.';
const AGAIN = 'A code for this exact act was sent to your person already. Ask your person for the code. Then call this tool again with the same arguments and confirmCode. Madar sends a new code only after the old one ends.';
const LIMIT = 'Madar sent many codes to your person in the last hour. Tell your person. Try again later.';
const WRONG = 'The code is not right. A wrong code counts: after 5 wrong codes the code stops working. Ask your person to read the code in the Madar email again.';
const INVALID = 'Madar has no code that works for this exact act. The code may be used, too old or for other arguments. Call this tool again without confirmCode to get a new code by email.';

/**
 * The answer of a stop, after the transaction of the act rolled back. A first call records one confirmation and one mail row in a
 * transaction of its own, then runs the mail (afterCommit, as runCall runs the effects of a write). A wrong code adds one try.
 */
export async function answerStop(
  deps: Deps, data: CallData, afterCommit: (deps: Deps, ids: string[]) => Promise<unknown>, stop: Stop,
): Promise<ApiError> {
  if (stop.kind === 'invalid') return forbidden(INVALID, { reason: 'confirm_invalid' });
  // A wrong code has its try counted already (tryCode), before the compare.
  if (stop.kind === 'wrong') return forbidden(WRONG, { reason: 'confirm_wrong', maxTries: MAX_TRIES });
  const now = deps.clock.now();
  const made = await data.tx('write', async (t) => {
    const store = storeOf(t);
    // One live code for one exact act: a second first call sends no second mail.
    if (await store.live({ personId: stop.personId, agentId: stop.agentId, call: stop.call, inputHash: stop.inputHash, now })) return { kind: 'again' as const };
    if ((await store.madeSince(stop.personId, new Date(now.getTime() - HOUR_MS))) >= MAX_NEW_PER_HOUR) return { kind: 'limit' as const };
    const id = newConfirmId();
    const code = newCode();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    await store.add({
      id, personId: stop.personId, agentId: stop.agentId, call: stop.call, inputHash: stop.inputHash, codeHash: await codeHashOf(id, code), expiresAt, createdAt: now,
    });
    const ids = await t.outbox([{
      kind: CONFIRM_KIND,
      payload: { confirmId: id, personId: stop.personId, agent: cleanText(stop.agent), act: stop.act, code, expiresAt: expiresAt.toISOString() },
    }]);
    return { kind: 'sent' as const, ids };
  });
  if (made.kind === 'limit') return forbidden(LIMIT, { reason: 'confirm_limit' });
  if (made.kind === 'sent') {
    try {
      await afterCommit(deps, made.ids);
    } catch (error) {
      // The job runs the row again. The message names no code.
      deps.log.warn('The mail with the code of an agent act did not run. The job tries it again.', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return forbidden(made.kind === 'again' ? AGAIN : NEEDED, { reason: 'confirm_needed', expiresInMinutes: MINUTES });
}

// ---------- The mail ----------

const RoleLabelSchema = z.union([
  z.object({ kind: z.literal('system'), id: z.enum(BUILT_IN_ROLES) }),
  z.object({ kind: z.literal('custom'), name: z.string(), nameAr: z.string() }),
]);
const ListedSchema = z.object({ items: z.array(z.string()), more: z.number().int().min(0) });
const Payload = z.object({
  confirmId: z.string().min(1),
  personId: z.string().min(1),
  agent: z.string(),
  act: z.object({
    key: z.enum(['usersCreate', 'usersRole', 'usersDeactivate', 'usersReactivate', 'usersRemove', 'rolesCreate', 'rolesUpdate', 'rolesDelete']),
    target: z.object({ name: z.string(), nameAr: z.string() }),
    detail: z.string().optional(),
    role: RoleLabelSchema.optional(),
    from: RoleLabelSchema.optional(),
    added: ListedSchema.optional(),
    removed: ListedSchema.optional(),
    newName: z.string().optional(),
    newNameAr: z.string().optional(),
    moveTo: RoleLabelSchema.optional(),
  }),
  code: z.string().regex(/^\d{6}$/).optional(),
  expiresAt: z.string().min(1),
});

type Words = Record<string, unknown>;

function wordsOf(lang: Language): Words {
  return ((lang === 'ar' ? ar : en) as unknown as { mcpGuardMail: Words }).mcpGuardMail;
}

function text(words: Words, key: string, reader: Gender | undefined): string {
  return pick(words as Record<string, string>, key, reader);
}

/** A capped list as one text: "a, b, and 4 more". The comma of the language joins the items. */
function listText(lang: Language, words: Words, list: Listed): string {
  const comma = lang === 'ar' ? '، ' : ', ';
  const more = list.more > 0 ? [fill((words.lines as Record<string, string>).more, { n: String(list.more) })] : [];
  return [...list.items, ...more].join(comma);
}

/** The lines of the mail after the first one, for the role acts. */
function detailLines(lang: Language, words: Words, act: z.infer<typeof Payload>['act'], roleText: (label: z.infer<typeof RoleLabelSchema> | undefined) => string): string[] {
  const lines = words.lines as Record<string, string>;
  const out: string[] = [];
  if (act.key === 'rolesCreate') {
    if (act.added) out.push(fill(lines.rightsGive, { list: listText(lang, words, act.added) }));
    if (act.removed) out.push(fill(lines.basicsOff, { list: listText(lang, words, act.removed) }));
  }
  if (act.key === 'rolesUpdate') {
    if (act.newName) out.push(fill(lines.newName, { name: act.newName }));
    if (act.newNameAr) out.push(fill(lines.newNameAr, { name: act.newNameAr }));
    if (act.added) out.push(fill(lines.rightsAdd, { list: listText(lang, words, act.added) }));
    if (act.removed) out.push(fill(lines.rightsRemove, { list: listText(lang, words, act.removed) }));
  }
  if (act.key === 'rolesDelete' && act.moveTo) out.push(fill(lines.moveTo, { role: roleText(act.moveTo) }));
  return out;
}

export type RenderedConfirmMail = { subject: string; html: string; text: string };

/**
 * The mail to the person: the one plain line of what the agent asks, the code, and how long it works. It holds no link and no other secret.
 * The names are those in the language of the person (personName rule). The role names of the built-in roles come from the word files.
 */
export function renderConfirmMail(
  lang: Language, data: { act: z.infer<typeof Payload>['act']; agent: string; code: string; appUrl?: string }, reader?: Gender,
): RenderedConfirmMail {
  const words = wordsOf(lang);
  const roleNames = words.roleNames as Record<string, string>;
  const roleText = (label: z.infer<typeof RoleLabelSchema> | undefined) =>
    label?.kind === 'custom' ? (lang === 'ar' ? label.nameAr : label.name) : label ? roleNames[label.id] : '';
  const role = roleText(data.act.role);
  // A built-in role has no name of its own in the office: its target shows the name of the role in the word files.
  const builtIn = data.act.key === 'rolesUpdate' && data.act.role?.kind === 'system';
  const line = fill((words.act as Record<string, string>)[data.act.key], {
    agent: data.agent,
    target: builtIn ? role : lang === 'ar' ? data.act.target.nameAr : data.act.target.name,
    detail: data.act.detail ?? '',
    role,
    from: roleText(data.act.from),
  });
  // The lines after the first say what the act does: the rights, the names and the people who move (fix of 2026-10-26).
  const lines = [line, ...detailLines(lang, words, data.act, roleText)];
  const subject = text(words, 'subject', reader);
  const title = text(words, 'title', reader);
  const intro = text(words, 'codeIntro', reader);
  const validity = text(words, 'validity', reader);
  const note = text(words, 'note', reader);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const mailText = [title, '', ...lines, '', intro, data.code, '', validity, '', note].join('\n');
  const html = page(lang, [
    brandHeader(mailWords(lang)('mail.common.brand'), dir, data.appUrl ? logoAddress(data.appUrl) : undefined),
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>`,
    ...lines.map((one, i) => `<p style="font-size:15px;line-height:1.5;margin:0 0 ${i === lines.length - 1 ? 24 : 8}px">${escapeHtml(one)}</p>`),
    `<p style="font-size:15px;line-height:1.5;margin:0 0 8px">${escapeHtml(intro)}</p>`,
    `<p dir="ltr" style="font-size:32px;line-height:1.2;letter-spacing:6px;font-weight:700;margin:0 0 24px;text-align:center">${escapeHtml(data.code)}</p>`,
    `<p style="font-size:13px;line-height:1.5;color:#6e6e73;margin:0 0 16px">${escapeHtml(validity)}</p>`,
    `<p style="font-size:13px;line-height:1.5;color:#6e6e73;margin:0">${escapeHtml(note)}</p>`,
  ]);
  return { subject, html, text: mailText };
}

const PERSON_SQL = 'select doc from users where id = $1';
const PERSON_LITE = 'select doc from users where id = ?1';
/** Removes the code from the outbox row once the mail went (or can never go). */
export const SCRUB_SQL = "update outbox set payload = payload - 'code'::text where kind = 'mcp.confirm' and payload->>'confirmId' = $1";
export const SCRUB_LITE = "update outbox set payload = json_remove(payload, '$.code') where kind = 'mcp.confirm' and json_extract(payload, '$.confirmId') = ?1";

async function scrub(deps: Deps, confirmId: string): Promise<void> {
  try {
    await deps.db.statement('write', sqlFor(deps.db, SCRUB_SQL, SCRUB_LITE), [confirmId]);
  } catch (error) {
    deps.log.warn('The code of an agent act stayed in its outbox row.', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * The effect mcp.confirm: sends the mail with the code to the person. It reads the person again when it runs, sends to the address of the
 * person only, counts as sign-in mail against the day quota (the invitation does too), and removes the code from its row. A row that ran
 * after the end time sends nothing: a late code is a dead code.
 */
export async function sendConfirmMail(raw: Record<string, unknown>, deps: Deps): Promise<void> {
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) throw new Error('The mcp.confirm payload is not complete.');
  const payload = parsed.data;
  if (payload.code === undefined || new Date(payload.expiresAt).getTime() <= deps.clock.now().getTime()) {
    await scrub(deps, payload.confirmId);
    return;
  }
  const [row] = await deps.db.statement<{ doc: unknown }>('read', sqlFor(deps.db, PERSON_SQL, PERSON_LITE), [payload.personId]);
  const person = row ? User.parse(row.doc) : undefined;
  if (!person || !person.active || person.kind !== 'human') {
    await scrub(deps, payload.confirmId);
    return;
  }
  const mail = renderConfirmMail(person.preferences.language, { act: payload.act, agent: payload.agent, code: payload.code, appUrl: deps.config.appUrl }, person.gender ?? undefined);
  const sent = await sendCounted(deps, 'signin', { to: person.email, ...mail, tag: 'confirm', idempotencyKey: `mcp-confirm-${payload.confirmId}` }, { userId: person.id });
  if (sent.status === 'over') throw new QuotaFull('The mail with the code of an agent act did not go out: the daily mail quota is full. The job tries it again.', deps.clock.now());
  await scrub(deps, payload.confirmId);
}

let registered = false;

/** Registers the effect once. runCall imports this module, so every entry that runs calls has it. */
export function registerGuardEffects(): void {
  if (registered) return;
  registered = true;
  registerEffect(CONFIRM_KIND, sendConfirmMail);
}

registerGuardEffects();
