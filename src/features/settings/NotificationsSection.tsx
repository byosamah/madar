import { useTranslation } from 'react-i18next';
import { isEmailTrigger } from '../../api/contract/entities';
import { emailOn, inAppOn, morningSummaryOn, visibleTriggers } from '../../api/notify';
import { REMOTE } from '../../app/mode';
import { useAction, useCall } from '../../app/runtime';
import { Switch } from '../../components/Switch';
import { useBare } from './bare';
import { SettingsSection } from './Section';

/** One switch of a trigger row. It has no label of its own: aria-label names the trigger and the channel. */
function ChannelSwitch({
  id, label, checked, disabled = false, describedBy, onChange,
}: { id: string; label: string; checked: boolean; disabled?: boolean; describedBy?: string; onChange: (next: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`pressable relative h-[31px] w-[51px] shrink-0 justify-self-center rounded-full disabled:opacity-40 ${checked ? 'bg-green' : 'bg-fill-strong'}`}
    >
      <span
        aria-hidden
        className={`absolute start-[2px] top-[2px] size-[27px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5 rtl:-translate-x-5' : ''}`}
      />
    </button>
  );
}

/**
 * The notification switches. They follow the person whose choices apply (the authority).
 * - The prototype build: one in-app switch for each trigger, as before.
 * - The remote build (plan 5.4; task N2.2): one row for each trigger with two switches, In app and Email, plus one Morning summary
 *   row. An email switch the person never set takes its default (on for a task assigned, a review request and a mention), and a
 *   missing Morning summary reads as on. With the in-app switch of a trigger off there is no notice, so there is no email either:
 *   the email switch of that row shows off, cannot change, and a short note says why.
 * - The notices of requests and bugs (owner, 2026-10-07): their rows come last and have no email switch. Only a person with the
 *   Admin right sees the switch of a new report. A switch the person never set reads as on.
 */
export function NotificationsSection() {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const save = useAction('notifications.updateSettings');
  // On the Me sub-page the Morning summary sits on the hub, and the column names stay under the title while the list scrolls.
  const bare = useBare();
  if (!session.data) return null;
  const preferences = session.data.authority.preferences;
  const triggers = visibleTriggers(session.data.authority);

  if (!REMOTE) {
    return (
      <SettingsSection title={t('settings.notifications')}>
        {triggers.map((name) => (
          <Switch
            key={name}
            id={`trigger-${name}`}
            label={t(`settings.triggers.${name}`)}
            checked={inAppOn(preferences, name)}
            onChange={(on) => save.mutate({ trigger: name, on })}
          />
        ))}
      </SettingsSection>
    );
  }

  const names = bare ? 'sticky top-0 z-10 bg-card py-1 text-footnote text-label-2' : 'text-footnote text-label-2';
  return (
    <SettingsSection title={t('settings.notifications')}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4">
        {/* The column names. Each switch already names its channel, so a screen reader skips them. */}
        <span aria-hidden />
        <span aria-hidden className={`${names} justify-self-center`}>{t('notices.inApp')}</span>
        <span aria-hidden className={`${names} justify-self-center`}>{t('notices.email')}</span>
        {triggers.map((name) => {
          const label = t(`settings.triggers.${name}`);
          const inApp = inAppOn(preferences, name);
          const email = isEmailTrigger(name);
          const noteId = `notice-${name}-note`;
          return (
            <div key={name} data-testid={`notice-row-${name}`} className="col-span-3 grid min-h-11 grid-cols-subgrid items-center py-1">
              <div className="min-w-0">
                <span className="block text-body">{label}</span>
                {email && !inApp && <p id={noteId} className="text-footnote text-label-2">{t('notices.emailNeedsApp')}</p>}
              </div>
              <ChannelSwitch
                id={`trigger-${name}`}
                label={t('notices.switchInApp', { trigger: label })}
                checked={inApp}
                onChange={(on) => save.mutate({ trigger: name, on })}
              />
              {email ? (
                <ChannelSwitch
                  id={`email-${name}`}
                  label={t('notices.switchEmail', { trigger: label })}
                  checked={inApp && emailOn(preferences, name)}
                  disabled={!inApp}
                  describedBy={inApp ? undefined : noteId}
                  onChange={(on) => save.mutate({ channel: 'email', trigger: name, on })}
                />
              ) : <span aria-hidden />}
            </div>
          );
        })}
      </div>
      {!bare && (
        <div className="border-t border-separator pt-2">
          <Switch
            id="morning-summary"
            label={t('notices.summary')}
            description={t('notices.summaryHint')}
            checked={morningSummaryOn(preferences)}
            onChange={(on) => save.mutate({ morningSummary: on })}
          />
        </div>
      )}
    </SettingsSection>
  );
}
