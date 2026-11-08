import { errorResponse } from '../http/errors';
import { PICTURE_DATA } from '../../src/api/contract/limits';
import { isEnterpriseId, type EnterpriseId } from './ids';
import type { EntRouter } from './router';

/**
 * GET /api/enterprise-logo/:ent (Madar enterprises, plan C, design 5.10): the logo of an enterprise for the header of a mail. Mail programs
 * load a picture by a public address, so the route needs no sign-in. It gives the same 404 for a malformed id, an id that the platform does not
 * list, an enterprise with no logo, a paused enterprise and a failure, so it tells a stranger nothing. The picture comes from the object
 * (the Settings the Admin edits), and only a WebP, JPEG or PNG data address becomes a picture (the type comes from the address, and the
 * answer carries nosniff, so it is never read as a page).
 */

const NOT_FOUND = { code: 'not_found', message: 'This address does not exist.' } as const;
const notFound = () => errorResponse(NOT_FOUND);

export async function logoResponse(router: Pick<EntRouter, 'listedStub'>, ent: unknown): Promise<Response> {
  if (!isEnterpriseId(ent)) return notFound();
  try {
    const target = await router.listedStub(ent);
    if (!target) return notFound();
    const { logo } = await target.stub.brand({ ent: target.ent as EnterpriseId });
    if (logo === null || !PICTURE_DATA.test(logo)) return notFound();
    const comma = logo.indexOf(',');
    const type = logo.slice('data:'.length, logo.indexOf(';'));
    const bytes = Uint8Array.from(atob(logo.slice(comma + 1)), (char) => char.charCodeAt(0));
    return new Response(bytes, {
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return notFound();
  }
}
