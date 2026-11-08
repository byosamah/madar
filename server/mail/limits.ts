import type { QuotaKind } from './quota';

/**
 * The limits of the mail quota from the mails a UTC day that the account may send (the Resend Free plan sends 100). Notice and
 * summary mail stops at 90 percent. Sign-in mail and warnings keep the last two places, so a person who waits for a link still gets one.
 */
export function quotaLimitsOf(total: number): Record<QuotaKind, number> {
  const notice = Math.floor(total * 0.9);
  const signin = total - 2;
  return { notice, summary: notice, signin, warning: signin };
}
