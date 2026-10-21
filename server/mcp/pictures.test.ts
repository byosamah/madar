import { describe, expect, it } from 'vitest';
import { personGlowCss, projectColorLook, tileSvg } from '../../src/lib/pictureLook';
import type { RunCall } from '../core/runCall';
import type { OfficeSnapshot, RunRequest, RunResult } from '../core/types';
import { fakeDeps } from '../test/fakes/deps';
import { COVER_MAX_BYTES, runPicture, withPictureLooks, type PictureAnswer } from './pictures';

/**
 * The pictures for agents (owner, 2026-10-21): the picture fields of the five answers, and pictures.get on a stub runCall. The rights
 * of the calls that pictures.get runs are the rights of the screens; app.test.ts runs them on the memory office.
 */

const AVATAR = `data:image/webp;base64,${'UklGR'.padEnd(400, 'A')}`;
const LOGO = `data:image/png;base64,${'iVBOR'.padEnd(200, 'A')}=`;

const office = {
  version: 1,
  lists: {
    users: {
      usr_002: { id: 'usr_002', name: 'Faisal', kind: 'human', avatarUrl: AVATAR },
      usr_004: { id: 'usr_004', name: 'Noura', kind: 'human', avatarUrl: null },
    },
    subCompanies: {
      sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: LOGO },
      sub_002: { id: 'sub_002', name: 'Bunah', nameAr: 'بناه', logo: null },
    },
  },
} as unknown as OfficeSnapshot;

const USERS = [
  { id: 'usr_002', name: 'Faisal', nameAr: 'فيصل', kind: 'human', avatarUrl: AVATAR },
  { id: 'usr_003', name: 'Old Link', kind: 'human', avatarUrl: 'https://pictures.example/old.png' },
  { id: 'usr_004', name: 'Noura', kind: 'human', avatarUrl: null },
  { id: 'usr_005', name: 'Not Safe', kind: 'human', avatarUrl: 'http://pictures.example/a.png' },
  { id: 'usr_009', name: 'Madar Assistant', kind: 'agent', avatarUrl: null },
];
const SUBS = [
  { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: LOGO, projectCount: 2 },
  { id: 'sub_002', name: 'Bunah', nameAr: 'بناه', logo: null, projectCount: 0 },
];
const PROJECT = { id: 'prj_001', code: 'KH-26-014', name: 'Villa', mark: 12, coverFileId: 'fil_001', subCompanyId: 'sub_001' };

describe('the picture fields of the answers (owner, 2026-10-21)', () => {
  it('gives users.list hasPicture and glow, and the picture data only with withPictures', () => {
    const lean = withPictureLooks('users.list', USERS, office, false) as Record<string, unknown>[];
    expect(lean[0]).toMatchObject({ id: 'usr_002', avatarUrl: null, hasPicture: true, glow: personGlowCss('usr_002') });
    // An https picture is a short address, so it stays. An old value that the screens do not show is no picture.
    expect(lean[1]).toMatchObject({ avatarUrl: 'https://pictures.example/old.png', hasPicture: true });
    expect(lean[2]).toMatchObject({ avatarUrl: null, hasPicture: false, glow: personGlowCss('usr_004') });
    expect(lean[3]).toMatchObject({ avatarUrl: null, hasPicture: false });
    // An agent has no glow: the screens show it as a sparkle sign on indigo.
    expect(lean[4]).toMatchObject({ hasPicture: false });
    expect(lean[4]).not.toHaveProperty('glow');
    expect(JSON.stringify(lean)).not.toContain('data:image');
    const full = withPictureLooks('users.list', USERS, office, true) as Record<string, unknown>[];
    expect(full[0]).toMatchObject({ avatarUrl: AVATAR, hasPicture: true });
    expect(full[3]).toMatchObject({ avatarUrl: null });
  });

  it('gives subCompanies.list hasLogo, and the logo data only with withPictures', () => {
    const lean = withPictureLooks('subCompanies.list', SUBS, office, false) as Record<string, unknown>[];
    expect(lean).toEqual([{ ...SUBS[0], logo: null, hasLogo: true }, { ...SUBS[1], logo: null, hasLogo: false }]);
    const full = withPictureLooks('subCompanies.list', SUBS, office, true) as Record<string, unknown>[];
    expect(full.map((sub) => sub.logo)).toEqual([LOGO, null]);
  });

  it('gives each project of projects.list and projects.get its look: the project color and the tile drawing', () => {
    const look = { color: projectColorLook('prj_001'), tile: tileSvg({ id: 'prj_001', mark: 12 }) };
    const rows = withPictureLooks('projects.list', [{ project: PROJECT, health: null }], office, false) as Record<string, unknown>[];
    expect(rows).toEqual([{ project: PROJECT, health: null, look }]);
    expect(withPictureLooks('projects.get', { project: PROJECT, members: [] }, office, false)).toEqual({ project: PROJECT, members: [], look });
  });

  it('gives reports.office the looks of its rows, and with withPictures each picture of a person and each logo once', () => {
    const report = {
      period: { kind: 'month' },
      projects: [
        { project: { id: 'prj_001', code: 'A', name: 'A', mark: 1 }, subCompany: { id: 'sub_001', name: 'Vado', nameAr: 'فادو' } },
        { project: { id: 'prj_002', code: 'B', name: 'B', mark: 2 }, subCompany: { id: 'sub_001', name: 'Vado', nameAr: 'فادو' } },
        { project: { id: 'prj_003', code: 'C', name: 'C', mark: 3 }, subCompany: { id: 'sub_002', name: 'Bunah', nameAr: 'بناه' } },
        { project: { id: 'prj_004', code: 'D', name: 'D', mark: 4 }, subCompany: null },
      ],
      // The card of a person holds an https picture only: the picture data comes from the office list.
      people: [{ user: { id: 'usr_002', name: 'Faisal', kind: 'human', avatarUrl: null }, tasksDone: 2 }, { user: { id: 'usr_004', name: 'Noura', kind: 'human', avatarUrl: null }, tasksDone: 0 }],
    };
    const lean = withPictureLooks('reports.office', report, office, false) as typeof report & { projects: Record<string, unknown>[]; people: { user: Record<string, unknown> }[] };
    expect(lean.projects[0]).toMatchObject({ subCompany: { id: 'sub_001', hasLogo: true }, look: { color: projectColorLook('prj_001'), tile: tileSvg({ id: 'prj_001', mark: 1 }) } });
    expect(lean.projects[2]).toMatchObject({ subCompany: { id: 'sub_002', hasLogo: false } });
    expect(lean.projects[3]).toMatchObject({ subCompany: null });
    expect(lean.people[0].user).toMatchObject({ avatarUrl: null, hasPicture: true, glow: personGlowCss('usr_002') });
    expect(lean).not.toHaveProperty('subCompanyLogos');
    expect(JSON.stringify(lean)).not.toContain('data:image');
    const full = withPictureLooks('reports.office', report, office, true) as typeof lean & { subCompanyLogos: Record<string, string> };
    expect(full.people.map((row) => row.user.avatarUrl)).toEqual([AVATAR, null]);
    expect(full.subCompanyLogos).toEqual({ sub_001: LOGO });
    expect(JSON.stringify(full).split(LOGO)).toHaveLength(2);
  });

  it('leaves the answers of the other tools as they are', () => {
    const rows = [{ id: 'tsk_001', avatarUrl: AVATAR }];
    expect(withPictureLooks('tasks.list', rows, office, true)).toBe(rows);
  });
});

/** A runCall that answers each call from a table, and keeps the requests. */
function stubRun(answers: Record<string, RunResult>): { runCall: RunCall; requests: RunRequest[] } {
  const requests: RunRequest[] = [];
  const runCall = (async (_deps: unknown, req: RunRequest) => {
    requests.push(req);
    return answers[req.name] ?? { ok: false, error: { code: 'not_found', message: 'No such call.', details: {} } };
  }) as unknown as RunCall;
  return { runCall, requests };
}

const ok = (output: unknown): RunResult => ({ ok: true, output, changed: false });
const LINK = ok({ url: 'https://files.test/get/prj-001/upl-a/thumb?disposition=inline', expiresAt: '2026-10-21T09:10:00.000Z', name: 'Cover.jpg', mimeType: 'image/jpeg', size: 4_000_000 });
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0)), new Array(40).fill(7)));

function ctxOf(answers: Record<string, RunResult>, fetch?: typeof globalThis.fetch) {
  const { runCall, requests } = stubRun(answers);
  return { ctx: { deps: fakeDeps(), principal: { userId: 'usr_009', agent: { clientId: 'cli-1' } }, office, runCall, ...(fetch ? { fetch } : {}) }, requests };
}

const fetchOf = (body: BodyInit | null, init: ResponseInit = {}) => {
  const urls: string[] = [];
  const fetch = (async (url: string) => {
    urls.push(url);
    return new Response(body, init);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, urls };
};

const output = (result: RunResult) => (result.ok ? (result.output as PictureAnswer) : undefined);

describe('pictures.get (owner, 2026-10-21)', () => {
  it('gives a profile picture as data and as an image, read through users.list as the agent', async () => {
    const { ctx, requests } = ctxOf({ 'users.list': ok(USERS) });
    const answer = output(await runPicture({ kind: 'person', id: 'usr_002' }, ctx))!;
    expect(answer.output).toEqual({
      kind: 'person', id: 'usr_002', name: 'Faisal', nameAr: 'فيصل', glow: personGlowCss('usr_002'),
      picture: { mimeType: 'image/webp', bytes: 300, dataUrl: AVATAR },
    });
    expect(answer.image).toEqual({ data: AVATAR.slice(AVATAR.indexOf(',') + 1), mimeType: 'image/webp' });
    // The call runs as the agent, with the people who are turned off too, and nothing else.
    expect(requests.map((req) => [req.name, req.input, req.principal.userId])).toEqual([['users.list', { includeInactive: true }, 'usr_009']]);
  });

  it('gives an https picture as its address, no picture as null, and an unknown person as not_found', async () => {
    const { ctx } = ctxOf({ 'users.list': ok(USERS) });
    expect(output(await runPicture({ kind: 'person', id: 'usr_003' }, ctx))).toEqual({ output: expect.objectContaining({ picture: { url: 'https://pictures.example/old.png' } }) });
    expect(output(await runPicture({ kind: 'person', id: 'usr_004' }, ctx))).toEqual({ output: expect.objectContaining({ picture: null, glow: personGlowCss('usr_004') }) });
    expect(output(await runPicture({ kind: 'person', id: 'usr_005' }, ctx))!.output.picture).toBeNull();
    expect(output(await runPicture({ kind: 'person', id: 'usr_009' }, ctx))!.output).not.toHaveProperty('glow');
    expect(await runPicture({ kind: 'person', id: 'usr_404' }, ctx)).toEqual({ ok: false, error: { code: 'not_found', message: 'User usr_404 does not exist.', details: { id: 'usr_404' } } });
  });

  it('gives a sub-company logo as data and as an image, and no logo as null', async () => {
    const { ctx } = ctxOf({ 'subCompanies.list': ok(SUBS) });
    const vado = output(await runPicture({ kind: 'subCompany', id: 'sub_001' }, ctx))!;
    expect(vado.output).toEqual({ kind: 'subCompany', id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: { mimeType: 'image/png', bytes: 149, dataUrl: LOGO } });
    expect(vado.image?.mimeType).toBe('image/png');
    expect(output(await runPicture({ kind: 'subCompany', id: 'sub_002' }, ctx))).toEqual({ output: expect.objectContaining({ logo: null }) });
    expect(await runPicture({ kind: 'subCompany', id: 'sub_404' }, ctx)).toMatchObject({ ok: false, error: { code: 'not_found', message: 'Sub-company sub_404 does not exist.' } });
  });

  it('draws the project tile from projects.get, so a project the person may not open fails as it does there', async () => {
    const { ctx, requests } = ctxOf({ 'projects.get': ok({ project: PROJECT }) });
    expect(output(await runPicture({ kind: 'projectTile', id: 'prj_001' }, ctx))).toEqual({
      output: { kind: 'projectTile', id: 'prj_001', code: 'KH-26-014', name: 'Villa', subCompanyId: 'sub_001', color: projectColorLook('prj_001'), tile: tileSvg(PROJECT) },
    });
    expect(requests.map((req) => [req.name, req.input])).toEqual([['projects.get', { id: 'prj_001' }]]);
    const refusal: RunResult = { ok: false, error: { code: 'not_found', message: 'Project prj_404 does not exist.', details: { id: 'prj_404' } } };
    const missing = ctxOf({ 'projects.get': refusal });
    expect(await runPicture({ kind: 'projectTile', id: 'prj_404' }, missing.ctx)).toEqual(refusal);
    expect(await runPicture({ kind: 'projectCover', id: 'prj_404' }, missing.ctx)).toEqual(refusal);
    expect(missing.requests.map((req) => req.name)).toEqual(['projects.get', 'projects.get']);
  });

  it('gives a cover of 200 KB or less as an image and a 10-minute link, read from the small picture that files.link signs', async () => {
    const { fetch, urls } = fetchOf(WEBP, { headers: { 'content-type': 'image/webp' } });
    const { ctx, requests } = ctxOf({ 'projects.get': ok({ project: PROJECT }), 'files.link': LINK }, fetch);
    const answer = output(await runPicture({ kind: 'projectCover', id: 'prj_001' }, ctx))!;
    expect(answer.output).toEqual({
      kind: 'projectCover', id: 'prj_001',
      cover: { fileId: 'fil_001', url: (LINK as { output: { url: string } }).output.url, expiresAt: '2026-10-21T09:10:00.000Z', mimeType: 'image/webp', bytes: WEBP.length, inline: true },
    });
    expect(answer.image).toEqual({ data: btoa(String.fromCharCode(...WEBP)), mimeType: 'image/webp' });
    expect(requests.map((req) => [req.name, req.input])).toEqual([
      ['projects.get', { id: 'prj_001' }],
      ['files.link', { id: 'fil_001', variant: 'thumb', disposition: 'inline' }],
    ]);
    expect(urls).toEqual([(LINK as { output: { url: string } }).output.url]);
  });

  it('gives a larger cover, a cover that is no picture or a cover that does not load as the link only', async () => {
    const big = new Uint8Array(COVER_MAX_BYTES + 1);
    big.set(WEBP);
    const cases: [string, typeof globalThis.fetch][] = [
      ['too large by its length', fetchOf(new Uint8Array(10), { headers: { 'content-length': String(COVER_MAX_BYTES + 1) } }).fetch],
      // No length header: the read stops at the limit.
      ['too large as it streams', fetchOf(new ReadableStream({ start(c) { c.enqueue(big.subarray(0, 150_000)); c.enqueue(big.subarray(150_000)); c.close(); } })).fetch],
      ['not a picture', fetchOf(new TextEncoder().encode('<svg onload="x"></svg>')).fetch],
      ['a refusal of the store', fetchOf('No', { status: 403 }).fetch],
      ['a network failure', (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof globalThis.fetch],
    ];
    for (const [what, fetch] of cases) {
      const { ctx } = ctxOf({ 'projects.get': ok({ project: PROJECT }), 'files.link': LINK }, fetch);
      const answer = output(await runPicture({ kind: 'projectCover', id: 'prj_001' }, ctx))!;
      expect(answer.output.cover, what).toMatchObject({ fileId: 'fil_001', url: expect.stringContaining('https://files.test/'), inline: false });
      expect(answer.output.cover, what).not.toHaveProperty('mimeType');
      expect(answer.image, what).toBeUndefined();
    }
  });

  it('gives a project with no cover null, and passes a refusal of files.link on as it is', async () => {
    const none = ctxOf({ 'projects.get': ok({ project: { ...PROJECT, coverFileId: null } }) });
    expect(output(await runPicture({ kind: 'projectCover', id: 'prj_001' }, none.ctx))).toEqual({ output: { kind: 'projectCover', id: 'prj_001', cover: null } });
    expect(none.requests.map((req) => req.name)).toEqual(['projects.get']);
    const refusal: RunResult = { ok: false, error: { code: 'not_found', message: 'File fil_001 does not exist.', details: { id: 'fil_001' } } };
    const { ctx } = ctxOf({ 'projects.get': ok({ project: PROJECT }), 'files.link': refusal });
    expect(await runPicture({ kind: 'projectCover', id: 'prj_001' }, ctx)).toEqual(refusal);
  });

  it('refuses a kind it does not know before any call', async () => {
    const { ctx, requests } = ctxOf({});
    for (const args of [{ kind: 'file', id: 'fil_001' }, { kind: 'person' }, { kind: 'person', id: 'usr_002', extra: 1 }]) {
      expect(await runPicture(args, ctx)).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { fields: ['kind', 'id'] } } });
    }
    expect(requests).toEqual([]);
  });
});
