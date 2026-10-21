import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import type { ProjectTemplateRow } from '../../../api/handlers/projectTemplates';
import { useUndoable } from '../../../app/actions';
import { usePersonName } from '../../../app/personName';
import { can } from '../../../api/permissions';
import { useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { actorContext, counted } from '../../../lib/grammar';
import { templateDays } from '../../../lib/projectPlan';
import { ProjectTemplateEditor } from './ProjectTemplateEditor';
import { TemplateProjectsSheet } from './TemplateProjectsSheet';
import { duplicateDraft, type TemplateDraft } from './templateDraft';

/** "5 stages · 11 tasks · 60 working days". A former stage template has stages only, so its line names only them. */
function useSizeLine() {
  const { t } = useTranslation();
  return (template: ProjectTemplate) => {
    const days = templateDays(template);
    return [
      counted(t, 'projectTemplates.stageCount', template.stages.length),
      ...(template.tasks.length > 0 ? [counted(t, 'projectTemplates.taskCount', template.tasks.length)] : []),
      ...(days > 0 ? [counted(t, 'projectTemplates.dayCount', days)] : []),
    ].join(' · ');
  };
}

/**
 * The office's project templates (owner, 2026-10-05, item 6a): one row for each template, with its size, how many projects follow it
 * and who saved it. A row opens the template in the editor, and Duplicate opens a copy of it. "New template" opens an empty editor.
 * Stage templates of before are here as templates with stages and no tasks. Only a person with the right to update projects (the Admin, or a
 * role with templates.updateProjects) sends a template update, so only that person sees the update item, the count of projects, and the toast
 * "Update them" (ADM-03, ADM-05).
 */
export function ProjectTemplatesSection() {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const sizeOf = useSizeLine();
  const templates = useCall('projectTemplates.list', {});
  const toast = useToast();
  // The update of the projects of a template needs the right templates.updateProjects, which the Admin holds (role-rights, 2026-10-23).
  const authority = useCall('session.get', {}).data?.authority;
  const mayUpdate = authority !== undefined && can(authority, 'templates.updateProjects');
  // "New template" and "Duplicate" make a new template, so they need templates.projectCreate (role rights version 2).
  const mayCreate = authority !== undefined && can(authority, 'templates.projectCreate');
  // The number of projects that follow the template being deleted, for the words of the Undo toast.
  const deletedFollowers = useRef(0);
  const remove = useUndoable('projectTemplates.delete', {
    message: () => (deletedFollowers.current > 0 ? t('projectTemplates.deletedKept', { count: deletedFollowers.current }) : t('projectTemplates.deleted')),
  });
  const users = useCall('users.list', {});
  // A copy keeps a default person only while that person is active.
  const activeIds = new Set((users.data ?? []).filter((user) => user.kind === 'human' && user.active).map((user) => user.id));
  const names = (templates.data ?? []).map((other) => other.name);
  const copyWord = (name: string) => t('projectTemplates.copyOf', { name });
  // undefined: no editor. A new template: template null. A copy: the editor opens filled with its draft.
  const [editing, setEditing] = useState<{ template: ProjectTemplate | null; copy?: TemplateDraft } | undefined>(undefined);
  // The template whose projects the Admin updates. Null: no sheet. reviewAll: the sheet opens at the review, with every project ticked.
  const [updating, setUpdating] = useState<{ template: ProjectTemplate; reviewAll: boolean } | null>(null);
  // After a save of a template that projects follow, the toast offers the update (ADM-05).
  const saved = (row: ProjectTemplateRow, changed: boolean) => {
    const followers = changed && mayUpdate ? row.followers ?? 0 : 0;
    if (followers === 0) {
      toast.show({ message: t('projectTemplates.saved') });
      return;
    }
    toast.show({
      message: t('projectTemplates.savedFollowed', { count: followers }),
      action: { label: t('projectTemplates.updateThem'), run: () => setUpdating({ template: row, reviewAll: true }), isUndo: false },
    });
  };

  return (
    <section aria-labelledby="admin-project-templates" className="surface flex flex-col gap-3 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-project-templates" className="text-headline">{t('projectTemplates.title')}</h2>
        {mayCreate && (
          <Button onClick={() => setEditing({ template: null })}>
            <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
            {t('projectTemplates.new')}
          </Button>
        )}
      </div>
      <p className="text-footnote text-ink-2">{t('projectTemplates.intro')}</p>
      <LoadFailed query={templates} />
      {templates.data?.length === 0 && <p className="text-subheadline text-ink-2">{t('projectTemplates.empty')}</p>}
      <ul className="hairline flex flex-col">
        {(templates.data ?? []).map((template) => {
          const savedBy = t('projectTemplates.savedBy', {
            name: nameOf({ name: template.createdByName, nameAr: template.createdByNameAr }), context: actorContext({ gender: template.createdByGender }),
          });
          const body = (
            <span className="flex min-w-0 flex-1 flex-col">
              <bdi className="truncate font-semibold text-ink">{template.name}</bdi>
              <span className="text-footnote text-ink-2">{sizeOf(template)}</span>
              {(template.followers ?? 0) > 0 && <span className="text-footnote text-ink-2">{t('projectTemplates.followers', { count: template.followers })}</span>}
              <span className="text-footnote text-ink-2">{savedBy}</span>
            </span>
          );
          return (
            <li key={template.id} className="flex items-center gap-2 py-1">
              {template.canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing({ template })}
                  className="pressable flex min-h-14 min-w-0 flex-1 items-center rounded-xl px-2 py-2 text-start hover:bg-fill"
                >
                  {body}
                </button>
              ) : <div className="flex min-h-14 min-w-0 flex-1 items-center px-2 py-2">{body}</div>}
              {/* A person who may only update the projects (templates.updateProjects) gets the menu with that one item. */}
              {(template.canEdit || mayUpdate) && (
                <Menu
                  label={t('projectTemplates.actions', { name: template.name })}
                  items={[
                    {
                      label: t('projectTemplates.duplicate'),
                      onSelect: () => setEditing({ template: null, copy: duplicateDraft(template, names, activeIds, copyWord) }),
                      hidden: !template.canEdit || !mayCreate,
                    },
                    { label: t('projectTemplates.update.open'), onSelect: () => setUpdating({ template, reviewAll: false }), hidden: !mayUpdate },
                    {
                      label: t('projectTemplates.delete'),
                      onSelect: () => {
                        deletedFollowers.current = template.followers ?? 0;
                        remove.mutate({ id: template.id });
                      },
                      destructive: true,
                      hidden: !template.canEdit,
                    },
                  ]}
                />
              )}
            </li>
          );
        })}
      </ul>
      {editing !== undefined && (
        <ProjectTemplateEditor
          key={editing.template?.id ?? 'new'}
          template={editing.template}
          copy={editing.copy}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
        />
      )}
      {updating !== null && <TemplateProjectsSheet template={updating.template} reviewAll={updating.reviewAll} onClose={() => setUpdating(null)} />}
    </section>
  );
}
