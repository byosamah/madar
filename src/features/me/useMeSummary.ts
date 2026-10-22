import { useTranslation } from 'react-i18next';
import { adminReachOf } from '../../api/chatState';
import { useLang } from '../../app/lang';
import { REMOTE } from '../../app/mode';
import { useCall } from '../../app/runtime';
import { clockLabel, daysPhrase, effectiveWorkHours } from '../settings/workRange';

/**
 * The lines under the titles of the Me hub. `quiet` is null until settings.get answers, and the Google and reach lines are null where
 * they do not apply. A read that fails leaves its line out, so a row never waits for it and never shows a spinner.
 */
export type MeSummary = { role: string; quiet: string | null; notices: string; reach: string | null; gcal: string | null };

export function useMeSummary(): MeSummary {
  const { t } = useTranslation();
  const lang = useLang();
  const user = useCall('session.get', {}).data?.user;
  const settings = useCall('settings.get', {}).data;
  // Google is real in the real build only. The prototype has nothing to read.
  const google = useCall('google.status', {}, { enabled: REMOTE }).data;

  // A Member may hold a custom role of the office: the row then shows the name of that role (owner, 2026-10-18, fbk_014).
  const custom = user ? settings?.roles?.custom?.find((role) => role.id === user.roleId) : undefined;
  const role = !user ? '' : custom ? (lang === 'ar' ? custom.nameAr : custom.name) : t(`admin.roles.${user.systemRole}`);

  let quiet: string | null = null;
  if (user && settings) {
    const range = effectiveWorkHours(user.preferences, settings);
    quiet = range.quiet
      ? t('phoneMe.quietOn', { days: daysPhrase(range.days, lang, t), from: clockLabel(range.from, lang), to: clockLabel(range.to, lang) })
      : t('phoneMe.quietOff');
  }

  const state = REMOTE ? google?.state : undefined;
  const gcal = state === 'ok' || state === 'not_synced' ? t('phoneMe.gcalOn') : state === 'broken' ? t('phoneMe.gcalBroken') : null;

  return {
    role,
    quiet,
    notices: t(REMOTE ? 'phoneMe.noticesAppEmail' : 'phoneMe.noticesApp'),
    reach: user?.systemRole === 'admin' ? t(`adminReach.${adminReachOf(user)}.label`) : null,
    gcal,
  };
}
