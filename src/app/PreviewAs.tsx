import { useTranslation } from 'react-i18next';
import { useAction, useCall } from './runtime';

/** Prototype control: shows the app as another person (spec 3.3). */
export function PreviewAs({ id }: { id: string }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const previewAs = useAction('session.previewAs');
  if (!session.data) return null;
  return (
    <label className="flex flex-col gap-1.5" htmlFor={id}>
      <span className="flex items-center gap-2">
        <span className="field-label">{t('preview.label')}</span>
        <span className="inline-flex h-5 items-center rounded-full bg-fill px-2 text-caption font-medium leading-none text-ink-2">{t('preview.prototype')}</span>
      </span>
      <select
        id={id}
        value={session.data.user.id}
        onChange={(event) => previewAs.mutate({ userId: event.target.value })}
        className="field"
      >
        {session.data.previewUsers.map((user) => (
          <option key={user.id} value={user.id}>
            {`${user.name} · ${user.actingForName ? t('preview.agentFor', { name: user.actingForName }) : t(`preview.hint.${user.hint}`)}`}
          </option>
        ))}
      </select>
    </label>
  );
}
