import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { LoadFailed } from '../../components/LoadFailed';
import { Sheet } from '../../components/Sheet';
import { counted } from '../../lib/grammar';
import { LinkProjectSheet } from '../settings/admin/LinkProjectSheet';

/** "5 stages · 11 tasks". A template that came from a stage template has stages only, so its line names only them. */
function useSizeLine() {
  const { t } = useTranslation();
  return (template: ProjectTemplate) => [
    counted(t, 'projectTemplates.stageCount', template.stages.length),
    ...(template.tasks.length > 0 ? [counted(t, 'projectTemplates.taskCount', template.tasks.length)] : []),
  ].join(' · ');
}

/**
 * "Apply a template" in the project menu (owner, 2026-10-19, fbk_020): the leader and the Admin put a template on an ongoing project.
 * Step 1 is this list of the office templates with their sizes; one press on a row opens step 2, the matching sheet of the Admin's
 * link (LinkProjectSheet in mode "apply"), over this one. Cancel there comes back here. A project holds one template link, so a
 * project that follows a template takes another one only after the confirm tick, and the new template then replaces the link.
 */
export function ApplyTemplateSheet({ detail, open, onOpenChange }: { detail: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  // A closed sheet reads nothing (performance audit 2026-10-21, DF-5): the menu item starts the read on its press (ProjectActions).
  const templates = useCall('projectTemplates.list', {}, { enabled: open });
  const sizeLine = useSizeLine();
  const [chosen, setChosen] = useState<ProjectTemplate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const { project } = detail;
  const followedId = project.templateLink?.templateId ?? null;
  const followed = templates.data?.find((template) => template.id === followedId);
  // The template that the project follows is not in the list: the update of its projects is the Admin's tool.
  const choices = (templates.data ?? []).filter((template) => template.id !== followedId);
  const locked = followedId !== null && !confirmed;
  const close = (next: boolean) => {
    if (!next) {
      setChosen(null);
      setConfirmed(false);
    }
    onOpenChange(next);
  };
  return (
    <>
      <Sheet open={open} onOpenChange={close} title={t('projectTemplates.apply.title')} description={t('projectTemplates.apply.intro', { project: project.name })}>
        <div className="flex flex-col gap-4 pt-1">
          <LoadFailed query={templates} />
          {followedId !== null && (
            <div className="flex flex-col gap-1">
              <p className="text-subheadline font-semibold text-ink">
                {followed ? t('projectTemplates.apply.follows', { template: followed.name }) : t('projectTemplates.apply.followsPlain')}
              </p>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="size-5 shrink-0 accent-[var(--sig-from)]" />
                {t('projectTemplates.apply.another')}
              </label>
            </div>
          )}
          {templates.data !== undefined && choices.length === 0 && <p className="text-subheadline text-ink-2">{t('projectTemplates.apply.noTemplates')}</p>}
          <ul className="flex flex-col gap-2">
            {choices.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setChosen(template)}
                  className="pressable flex min-h-14 w-full flex-col items-start gap-0.5 rounded-2xl bg-fill px-4 py-2 text-start disabled:opacity-50"
                >
                  <bdi className="text-body font-semibold text-ink">{template.name}</bdi>
                  <span className="text-footnote text-ink-2">{sizeLine(template)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
      {open && chosen !== null && (
        <LinkProjectSheet
          mode="apply"
          projectId={project.id}
          template={chosen}
          replace={followedId !== null}
          onClose={() => setChosen(null)}
          onDone={() => close(false)}
        />
      )}
    </>
  );
}
