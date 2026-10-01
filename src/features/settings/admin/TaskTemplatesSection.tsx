import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskTemplateRow } from '../../../api/handlers/taskTemplates';
import { useUndoable } from '../../../app/actions';
import { useAction, useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';

type Row = Pick<TaskTemplateRow, 'id' | 'name' | 'stageName' | 'checklist' | 'createdByName' | 'canEdit'>;

/** A new name for a template, in the row. Enter saves, Escape leaves. */
function RenameForm({ template, onDone }: { template: Row; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(template.name);
  const rename = useAction('taskTemplates.rename', { onSuccess: onDone });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && name.trim() !== template.name) rename.mutate({ id: template.id, name: name.trim() });
        else onDone();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
    >
      <div className="min-w-0 flex-1">
        <TextField id={`rename-${template.id}`} label={t('taskTemplates.name')} dir="auto" maxLength={200} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </div>
      <Button type="submit" variant="primary" disabled={!name.trim() || rename.isPending}>{t('common.save')}</Button>
      <Button variant="plain" onClick={onDone}>{t('common.cancel')}</Button>
    </form>
  );
}

/** The saved tasks of the office, grouped by stage. The person who saved one, and the Admin, rename or delete it. */
export function TaskTemplatesSection() {
  const { t } = useTranslation();
  const templates = useCall('taskTemplates.list', {});
  const remove = useUndoable('taskTemplates.delete', { message: () => t('taskTemplates.deleted') });
  const [renaming, setRenaming] = useState<string | null>(null);
  const groups = new Map<string, Row[]>();
  for (const template of templates.data ?? []) groups.set(template.stageName, [...(groups.get(template.stageName) ?? []), template]);
  return (
    <section aria-labelledby="admin-task-templates" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-task-templates" className="text-headline">{t('taskTemplates.title')}</h2>
      {templates.error && !templates.data && <LoadFailed error={templates.error} onRetry={() => void templates.refetch()} />}
      {templates.data?.length === 0 && <p className="text-footnote text-ink-2">{t('taskTemplates.empty')}</p>}
      {[...groups].map(([stageName, rows]) => (
        <div key={stageName} role="group" aria-label={stageName} className="flex flex-col">
          <h3 dir="auto" className="text-subheadline font-semibold text-ink-2">{stageName}</h3>
          <ul className="flex flex-col">
            {rows.map((template) => (
              <li key={template.id} className="flex items-start gap-3 py-2">
                {renaming === template.id ? (
                  <div className="min-w-0 flex-1"><RenameForm template={template} onDone={() => setRenaming(null)} /></div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold"><bdi>{template.name}</bdi></p>
                    {template.checklist.length > 0 && <p className="text-footnote text-ink-2"><bdi>{template.checklist.join(' · ')}</bdi></p>}
                    <p className="text-footnote text-ink-2">{t('taskTemplates.savedBy', { name: template.createdByName })}</p>
                  </div>
                )}
                {renaming !== template.id && (
                  <Menu
                    label={t('taskTemplates.actions', { name: template.name })}
                    items={[
                      { label: t('taskTemplates.rename'), onSelect: () => setRenaming(template.id), hidden: !template.canEdit },
                      { label: t('taskTemplates.delete'), onSelect: () => remove.mutate({ id: template.id }), destructive: true, hidden: !template.canEdit },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
