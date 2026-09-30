import { useTranslation } from 'react-i18next';
import { useAction, useCall } from './runtime';

/** Prototype control: shows the app as another person (spec 3.3). */
export function PreviewAs({ id }: { id: string }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const previewAs = useAction('session.previewAs');
  if (!session.data) return null;
  return (
    <label className="block" htmlFor={id}>
      <span className="flex items-center gap-1.5 text-caption text-label-2">
        {t('preview.label')}
        <span className="rounded-full bg-fill px-1.5">{t('preview.prototype')}</span>
      </span>
      <select
        id={id}
        value={session.data.user.id}
        onChange={(event) => previewAs.mutate({ userId: event.target.value })}
        className="mt-1 min-h-11 w-full rounded-control bg-fill px-2 text-subheadline text-label"
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
