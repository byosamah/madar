import { CLIENT_ADDRESS_HEADER, createForgotRoute, FORGOT_PATH } from '../auth/forgot';
import { createRenewRoute, RENEW_PATH } from '../auth/renew';
import { runInHost } from '../core/after';
import type { Deps } from '../core/ports';

/**
 * The shape check and the limits of the forgot or the renew route, with the value of the mail work (Madar enterprises). The office object
 * runs it for a known email or key, and the platform object runs it for an unknown one (refuseMail), so both give the same status, the same
 * body and the same limit counting. The Worker counts the limit of the address before it chooses the enterprise and passes addressChecked, so the
 * address has one count for all enterprises (platform.hitAddress). The work is not run here: the caller keeps the value, and the Worker sends the mail in a second call.
 */
export async function runMailRoute(deps: Deps, input: { route: 'forgot' | 'renew'; body: string; address: string; addressChecked?: boolean }): Promise<{ status: number; body: string; work?: string }> {
  let work: string | undefined;
  const keep = async (value: string) => void (work = value);
  // No after on this host: the route waits for keep, which only notes the value. The Worker pads the answer to the minimum time.
  const host = () => ({ host: 'workers' as const });
  // addressChecked: the Worker counted the address in the platform object (hitAddress), so the route counts the email or the key only.
  const skipAddress = input.addressChecked === true;
  const route = input.route === 'forgot' ? createForgotRoute({ minMs: 0, host, work: keep, skipAddress }) : createRenewRoute({ minMs: 0, host, work: keep, skipAddress });
  const request = new Request(`https://office.internal/api${input.route === 'forgot' ? FORGOT_PATH : RENEW_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', [CLIENT_ADDRESS_HEADER]: input.address }, body: input.body,
  });
  const response = await runInHost({ host: 'workers' }, () => route(request, deps));
  return { status: response.status, body: await response.text(), ...(work === undefined ? {} : { work }) };
}
