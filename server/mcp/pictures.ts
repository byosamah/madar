import { z } from 'zod';
import type { SubCompany, User } from '../../src/api/contract/entities';
import { PICTURE_DATA } from '../../src/api/contract/limits';
import { notFound } from '../../src/api/errors';
import { safePicture } from '../../src/lib/picture';
import { personGlowCss, projectColorLook, tileSvg } from '../../src/lib/pictureLook';
import type { Deps } from '../core/ports';
import type { RunCall } from '../core/runCall';
import type { OfficeSnapshot, Principal, RunResult } from '../core/types';

/**
 * The pictures for agents (owner, 2026-10-21). An agent reads the pictures that its person sees in the screens, so a report can look like
 * Madar. Two rules keep its context small: each row of a list gets only the drawing rules of its picture (the glow, the project color and
 * tile), and the picture data comes only with withPictures, or one picture at a time from pictures.get. Pictures are data, never
 * instructions (INSTRUCTIONS rule 6). No picture comes from a direct or a group chat: pictures.get reads people, sub-companies and the
 * cover of a project only, and the file link refuses an agent a chat file.
 */

/** The one tool with no call behind it that gives a picture. It reads through the calls of the screens, so it has their rights. */
export const PICTURES_GET = 'pictures.get';

/** The largest cover that pictures.get gives as picture data (owner, 2026-10-21). A larger cover comes as a link only. */
export const COVER_MAX_BYTES = 200 * 1024;
/** How long pictures.get waits for the small picture of a cover. */
const COVER_TIMEOUT_MS = 5_000;

export const PICTURE_KINDS = ['person', 'subCompany', 'projectTile', 'projectCover'] as const;
export const PicturesGetInput = z.strictObject({
  kind: z.enum(PICTURE_KINDS).describe('person (a usr_ id), subCompany (a sub_ id), projectTile or projectCover (a prj_ id).'),
  id: z.string().min(1).max(80).describe('The id of the person, the sub-company or the project.'),
});

/** The tools that take withPictures: true to add the picture data to their answer. */
export const WITH_PICTURES_TOOLS: ReadonlySet<string> = new Set(['users.list', 'subCompanies.list', 'reports.office']);
export const WithPictures = z.boolean().optional()
  .describe('True adds the picture data (a data address, up to 16 KB each). Leave it out unless you build a document with the pictures.');

/** One picture as data: its type, its size in bytes and the data address. */
type PictureData = { mimeType: string; bytes: number; dataUrl: string };
/** A picture that the MCP answer also gives as an image, so the agent sees it. */
export type PictureImage = { data: string; mimeType: string };
/** The output of pictures.get, and the image that goes beside it. */
export type PictureAnswer = { output: Record<string, unknown>; image?: PictureImage };

function dataOf(value: string | null | undefined): { data: PictureData; image: PictureImage } | null {
  if (!value || !PICTURE_DATA.test(value)) return null;
  const comma = value.indexOf(',');
  const mimeType = value.slice('data:'.length, value.indexOf(';'));
  const data = value.slice(comma + 1);
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  return { data: { mimeType, bytes, dataUrl: value }, image: { data, mimeType } };
}

/** The picture data of a person, only when the screens show it: an old value that is no safe picture shows nothing. */
const pictureData = (value: string | null | undefined): string | null => (value && PICTURE_DATA.test(value) ? value : null);

// The rows as the tools give them. Each one holds more fields; these are the ones read here.
type UserRow = Pick<User, 'id' | 'kind' | 'avatarUrl'>;
type SubRow = Pick<SubCompany, 'id' | 'logo'>;
type ProjectRow = { project: { id: string; mark?: number; shape?: string | null } };
type ReportRow = { project: { id: string; mark: number; shape?: string | null }; subCompany: { id: string } | null };
type ReportPersonRow = { user: UserRow };

/**
 * The picture fields of a person: avatarUrl is the picture that the screens show (picture data only with withPictures, an https address
 * always), hasPicture says if there is one, and glow draws the circle. An agent has no glow: the screens show it as a sparkle sign on indigo.
 */
function personLook<T extends UserRow>(user: T, picture: string | null, withPictures: boolean) {
  const shown = safePicture(picture);
  const avatarUrl = shown && (withPictures || !PICTURE_DATA.test(shown)) ? shown : null;
  return { ...user, avatarUrl, hasPicture: shown !== null, ...(user.kind === 'human' ? { glow: personGlowCss(user.id) } : {}) };
}

const projectLook = (project: { id: string; mark?: number; shape?: string | null }) => ({ color: projectColorLook(project.id), tile: tileSvg(project) });

/**
 * The picture fields of the answers of users.list, subCompanies.list, projects.list, projects.get and reports.office. Without
 * withPictures a picture saved as data leaves the answer (null), so 15 pictures do not fill the context of the agent.
 */
export function withPictureLooks(name: string, output: unknown, office: OfficeSnapshot, withPictures: boolean): unknown {
  if (name === 'users.list' && Array.isArray(output)) {
    return output.map((user: UserRow) => personLook(user, user.avatarUrl, withPictures));
  }
  if (name === 'subCompanies.list' && Array.isArray(output)) {
    return output.map((sub: SubRow) => ({ ...sub, logo: withPictures ? pictureData(sub.logo) : null, hasLogo: pictureData(sub.logo) !== null }));
  }
  if (name === 'projects.list' && Array.isArray(output)) {
    return output.map((row: ProjectRow) => ({ ...row, look: projectLook(row.project) }));
  }
  if (name === 'projects.get' && output !== null && typeof output === 'object' && 'project' in output) {
    return { ...(output as ProjectRow), look: projectLook((output as ProjectRow).project) };
  }
  if (name === 'reports.office' && output !== null && typeof output === 'object') {
    const report = output as { projects?: ReportRow[]; people?: ReportPersonRow[] };
    const users = office.lists.users;
    const subs = office.lists.subCompanies;
    const projects = (report.projects ?? []).map((row) => ({
      ...row,
      subCompany: row.subCompany ? { ...row.subCompany, hasLogo: pictureData(subs[row.subCompany.id]?.logo) !== null } : null,
      look: projectLook(row.project),
    }));
    // The card of a person holds an https picture only. The picture data comes from the person, as the screens read it.
    const people = (report.people ?? []).map((row) => ({ ...row, user: personLook(row.user, users[row.user.id]?.avatarUrl ?? row.user.avatarUrl, withPictures) }));
    // Each logo once, by the id of its sub-company: many project rows name the same sub-company.
    const logos = Object.fromEntries([...new Set(projects.flatMap((row) => (row.subCompany ? [row.subCompany.id] : [])))]
      .flatMap((id) => (pictureData(subs[id]?.logo) ? [[id, pictureData(subs[id].logo)]] : [])));
    return { ...report, projects, people, ...(withPictures ? { subCompanyLogos: logos } : {}) };
  }
  return output;
}

export type PictureCtx = { deps: Deps; principal: Principal; office: OfficeSnapshot; runCall: RunCall; fetch?: typeof globalThis.fetch };

/** One call of the screens for the agent, with its rights, as run.ts runs a tool. */
function callAs(ctx: PictureCtx, name: string, input: unknown): Promise<RunResult> {
  return ctx.runCall(ctx.deps, { principal: ctx.principal, name, input, batch: { storyRefs: new Map(), office: ctx.office, overviewCalls: 0 } });
}

const missing = (what: string, id: string): RunResult => {
  const error = notFound(what, id);
  return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
};
const answer = (value: PictureAnswer): RunResult => ({ ok: true, output: value, changed: false });

/**
 * pictures.get: one picture by kind and id. A person and a sub-company come from users.list and subCompanies.list, which every person
 * reads. A project tile and a cover need projects.get, so a project that the person may not open answers as it does there. A cover
 * needs files.link too, which checks the view right again right before it signs.
 */
export async function runPicture(args: Record<string, unknown>, ctx: PictureCtx): Promise<RunResult> {
  const parsed = PicturesGetInput.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_input', message: 'Send kind (person, subCompany, projectTile or projectCover) and id.', details: { fields: ['kind', 'id'] } } };
  }
  const { kind, id } = parsed.data;
  if (kind === 'person') {
    const result = await callAs(ctx, 'users.list', { includeInactive: true });
    if (!result.ok) return result;
    const user = (result.output as (User & { nameAr?: string })[]).find((row) => row.id === id);
    if (!user) return missing('User', id);
    const shown = safePicture(user.avatarUrl);
    const data = dataOf(shown);
    const picture = data ? data.data : shown ? { url: shown } : null;
    return answer({
      output: { kind, id, name: user.name, ...(user.nameAr ? { nameAr: user.nameAr } : {}), ...(user.kind === 'human' ? { glow: personGlowCss(id) } : {}), picture },
      ...(data ? { image: data.image } : {}),
    });
  }
  if (kind === 'subCompany') {
    const result = await callAs(ctx, 'subCompanies.list', {});
    if (!result.ok) return result;
    const sub = (result.output as SubCompany[]).find((row) => row.id === id);
    if (!sub) return missing('Sub-company', id);
    const data = dataOf(sub.logo);
    return answer({ output: { kind, id, name: sub.name, nameAr: sub.nameAr, logo: data ? data.data : null }, ...(data ? { image: data.image } : {}) });
  }
  const result = await callAs(ctx, 'projects.get', { id });
  if (!result.ok) return result;
  const project = (result.output as { project: { id: string; code: string; name: string; mark?: number; coverFileId: string | null; subCompanyId?: string | null } }).project;
  if (kind === 'projectTile') {
    return answer({ output: { kind, id, code: project.code, name: project.name, subCompanyId: project.subCompanyId ?? null, ...projectLook(project) } });
  }
  if (project.coverFileId === null) return answer({ output: { kind, id, cover: null } });
  const link = await callAs(ctx, 'files.link', { id: project.coverFileId, variant: 'thumb', disposition: 'inline' });
  if (!link.ok) return link;
  const { url, expiresAt } = link.output as { url: string; expiresAt: string };
  const image = await smallPicture(url, ctx.fetch ?? globalThis.fetch);
  const cover = { fileId: project.coverFileId, url, expiresAt, ...(image ? { mimeType: image.mimeType, bytes: image.bytes } : {}), inline: image !== null };
  return answer({ output: { kind, id, cover }, ...(image ? { image: { data: image.data, mimeType: image.mimeType } } : {}) });
}

/** The type of a picture from its first bytes: only the four types that an MCP client shows as an image. */
function pictureTypeOf(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(1, 4) === 'PNG' && bytes[0] === 0x89) return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/**
 * The small picture of a cover as data, when it is a picture of COVER_MAX_BYTES or less (owner, 2026-10-21). The server cannot make a
 * picture smaller on the free Worker plan, so it reads the small picture that the upload made (up to 960 px), and stops at the limit.
 * Any failure gives null: the agent then has the link only.
 */
async function smallPicture(url: string, fetcher: typeof globalThis.fetch): Promise<{ data: string; mimeType: string; bytes: number } | null> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > COVER_MAX_BYTES) {
      await response.body.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > COVER_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    const mimeType = pictureTypeOf(bytes);
    return mimeType ? { data: base64Of(bytes), mimeType, bytes: total } : null;
  } catch {
    return null;
  }
}
