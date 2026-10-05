import { useTranslation } from 'react-i18next';
import { useUndoable } from '../../../app/actions';
import { usePersonName } from '../../../app/personName';
import { useCall } from '../../../app/runtime';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';
import { actorContext } from '../../../lib/grammar';

/** The saved stage lists of the office. The Admin deletes any of them. */
export function StageTemplatesSection() {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const templates = useCall('stageTemplates.list', {});
  const remove = useUndoable('stageTemplates.delete', { message: () => t('stageTemplates.deleted') });
  return (
    <section aria-labelledby="admin-stage-templates" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-stage-templates" className="text-headline">{t('stageTemplates.title')}</h2>
      <LoadFailed query={templates} />
      {templates.data?.length === 0 && <p className="text-footnote text-ink-2">{t('stageTemplates.empty')}</p>}
      <ul className="flex flex-col">
        {(templates.data ?? []).map((template) => (
          <li key={template.id} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold"><bdi>{template.name}</bdi></p>
              <p className="text-footnote text-ink-2"><bdi>{template.stages.join(' · ')}</bdi></p>
              <p className="text-footnote text-ink-2">{t('stageTemplates.savedBy', { name: nameOf({ name: template.createdByName, nameAr: template.createdByNameAr }), context: actorContext({ gender: template.createdByGender }) })}</p>
            </div>
            <Menu
              label={t('stageTemplates.actions', { name: template.name })}
              items={[{ label: t('stageTemplates.delete'), onSelect: () => remove.mutate({ id: template.id }), destructive: true }]}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
