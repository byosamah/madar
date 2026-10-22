import { useTranslation } from 'react-i18next';
import { useSwitchLanguage } from '../../app/languageTurn';
import { useMyState } from '../../app/live/hooks';
import { usePersonName } from '../../app/personName';
import { useAction, useCall, useRuntime } from '../../app/runtime';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CircleDashedIcon } from '../../components/icons/animated/circle-dashed';
import { LanguagesIcon } from '../../components/icons/animated/languages';
import { PaletteIcon } from '../../components/icons/animated/palette';
import { PersonFace } from '../../components/PersonFace';
import { actorContext } from '../../lib/grammar';
import { MeChoiceRow, MePanel, MeRow, MeSwitchRow } from './MeRow';
import { useMeSummary } from './useMeSummary';

const LANGUAGES = ['en', 'ar'] as const;
const THEMES = ['system', 'light', 'dark'] as const;

/**
 * Panel 1 of the hub: the Profile row (a link to /me/profile) and, where the app has a live port, the Away row. The face has the own
 * state dot. The line under the name reads "discipline, role". The row of Away saves at once, as the switch of the person menu did.
 */
export function ProfilePanel() {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const user = useCall('session.get', {}).data?.user;
  const summary = useMeSummary();
  const preferences = useAction('me.updatePreferences');
  const { live } = useRuntime();
  const myState = useMyState();
  if (!user) return null;
  const discipline = user.discipline.trim();
  const line = discipline ? t('phoneMe.disciplineRole', { discipline, role: summary.role }) : summary.role;
  const context = actorContext(user);
  return (
    <MePanel>
      <MeRow
        lead={<PersonFace user={user} size={56} mine />}
        title={nameOf(user)}
        lines={[line, t('phoneMe.profileLine')]}
        to="/me/profile"
      />
      {live && (
        <MeSwitchRow
          id="away-by-hand"
          icon={CircleDashedIcon}
          title={t('presence.showAway', { context })}
          lines={[t(user.preferences.awayByHand ? 'presence.awayByYou' : `presence.${myState}`, { context })]}
          checked={user.preferences.awayByHand === true}
          onChange={(next) => preferences.mutate({ awayByHand: next })}
        />
      )}
    </MePanel>
  );
}

/** Panel 2 of the hub: Language and Theme. The title sits on top and the choice under it at full width. */
export function LookPanel() {
  const { t } = useTranslation();
  const user = useCall('session.get', {}).data?.user;
  const preferences = useAction('me.updatePreferences');
  const switchLanguage = useSwitchLanguage();
  if (!user) return null;
  return (
    <MePanel>
      <MeChoiceRow
        icon={LanguagesIcon}
        title={t('settings.language')}
        layoutId="me-language"
        value={user.preferences.language}
        options={LANGUAGES.map((value) => ({ value, label: t(`settings.languages.${value}`) }))}
        onChange={switchLanguage}
      />
      <MeChoiceRow
        icon={PaletteIcon}
        title={t('settings.theme')}
        layoutId="me-theme"
        value={user.preferences.theme}
        options={THEMES.map((value) => ({ value, label: t(`settings.themes.${value}`) }))}
        onChange={(theme) => preferences.mutate({ theme })}
      />
    </MePanel>
  );
}
