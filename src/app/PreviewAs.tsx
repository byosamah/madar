import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { chooseFakeEnterprise } from './fakeEnterprise';
import { useLang } from './lang';
import { PROTOTYPE } from './mode';
import { usePersonName } from './personName';
import { useAction, useCall, useRuntime } from './runtime';

/**
 * Prototype control: shows the app as another person (spec 3.3). The real build has sign-in instead, so it draws nothing there.
 * With the fake directory (Madar enterprises, design 5.19) it first picks the fake company, then the person. The prototype has no platform
 * part (design 12, D12).
 */
export function PreviewAs({ id }: { id: string }) {
  return PROTOTYPE ? <PreviewAsControl id={id} /> : null;
}

function PreviewAsControl({ id }: { id: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const { directory } = useRuntime();
  const queryClient = useQueryClient();
  const session = useCall('session.get', {});
  const previewAs = useAction('session.previewAs');
  if (!session.data) return null;
  const fake = directory?.read();
  const current = session.data.enterprise?.id;

  const choosePerson = (value: string) => {
    previewAs.mutate({ userId: value });
    // Choosing the same person again changes no record, so the session is read again by hand.
    void queryClient.invalidateQueries({ queryKey: ['api', 'session.get'] });
  };

  return (
    <div className="flex flex-col gap-3">
      {fake && current && (
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-enterprise`}>
          <span className="field-label">{t('preview.enterprise')}</span>
          <select id={`${id}-enterprise`} value={current} onChange={(event) => chooseFakeEnterprise(event.target.value)} className="field">
            {fake.enterprises.map((row) => (
              <option key={row.id} value={row.id}>{lang === 'ar' ? row.nameAr : row.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5" htmlFor={id}>
        <span className="flex items-center gap-2">
          <span className="field-label">{t('preview.label')}</span>
          <span className="inline-flex h-5 items-center rounded-full bg-fill px-2 text-caption font-medium leading-none text-ink-2">{t('preview.prototype')}</span>
        </span>
        <select id={id} value={session.data.user.id} onChange={(event) => choosePerson(event.target.value)} className="field">
          {session.data.previewUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {`${nameOf(user)} · ${user.actingForName ? t('preview.agentFor', { name: nameOf({ name: user.actingForName, nameAr: user.actingForNameAr }) }) : t(`preview.hint.${user.hint}`)}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
