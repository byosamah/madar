import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { adminReachOf } from '../../api/chatState';
import { ADMIN_REACH_CHOICES } from '../../api/contract/entities';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { arrowStep } from '../../lib/keys';
import { SettingsSection } from './Section';

/**
 * Settings, "What reaches me" (owner, 2026-10-23): the one choice of an Admin. Three radio choices, each with one short line, saved at
 * once with a toast. "Only my work": like a Member. "My work, and the rest in the list": today. "Everything": every project chat message
 * counts, and the bell gets a copy of each notice of the office. Only a person with the Admin role sees the section. The group is one
 * Tab stop, and the arrow keys move the choice (the same rule as SegmentedControl).
 */
export function AdminReachSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useCall('session.get', {});
  const save = useAction('me.updatePreferences', { onSuccess: () => toast.show({ message: t('adminReach.saved') }) });
  const group = useRef<HTMLDivElement>(null);
  const user = session.data?.user;
  if (!user || user.systemRole !== 'admin') return null;
  const value = adminReachOf(user);
  const selected = ADMIN_REACH_CHOICES.indexOf(value);

  const pick = (next: (typeof ADMIN_REACH_CHOICES)[number]) => {
    if (next !== value) save.mutate({ adminReach: next });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event.key, document.documentElement.dir === 'rtl', true);
    if (step === 0) return;
    event.preventDefault();
    const index = (selected + step + ADMIN_REACH_CHOICES.length) % ADMIN_REACH_CHOICES.length;
    pick(ADMIN_REACH_CHOICES[index]);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };

  return (
    <SettingsSection title={t('adminReach.title')}>
      <div ref={group} role="radiogroup" aria-label={t('adminReach.title')} onKeyDown={onKeyDown} className="flex flex-col gap-1">
        {ADMIN_REACH_CHOICES.map((choice, index) => {
          const checked = choice === value;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === selected ? 0 : -1}
              onClick={() => pick(choice)}
              className="pressable flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 text-start hover:bg-fill/50"
            >
              <span aria-hidden className={`mt-0.5 size-5 shrink-0 rounded-full border ${checked ? 'border-[6px] border-ink' : 'border-separator'}`} />
              <span className="flex min-w-0 flex-col">
                <span className="text-body">{t(`adminReach.${choice}.label`)}</span>
                <span className="text-footnote text-label-2">{t(`adminReach.${choice}.hint`)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}
