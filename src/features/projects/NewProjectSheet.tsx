import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { MAX_FILE_BYTES } from '../../api/contract/entities';
import { errorMessage } from '../../app/errors';
import { useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { emptyProjectForm } from './projectForm';
import { ProjectFields, useProjectForm } from './ProjectFields';

function focusFirstError(): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/** Anyone can create a project (spec 2.2). Only the name is required (spec 4.4). */
export function NewProjectSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { api } = useRuntime();
  const settings = useCall('settings.get', {});
  const defaults = settings.data?.defaultStages ?? [];
  const form = useProjectForm(emptyProjectForm(defaults));
  const [cover, setCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.reset(emptyProjectForm(settings.data?.defaultStages ?? []));
    setCover(null);
    // The form starts empty each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.data]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.check()) {
      focusFirstError();
      return;
    }
    const v = form.values;
    setSaving(true);
    try {
      const detail = await api.call('projects.create', {
        name: v.name.trim(),
        clientId: v.clientId || null,
        leader: v.leader,
        location: v.location.trim(),
        areaM2: v.area.trim() ? Number(v.area) : null,
        startDate: v.startDate || null,
        targetEndDate: v.targetEndDate || null,
        stages: v.stages.map((stage) => stage.name.trim()),
        teamIds: v.teamIds,
        modelFolderPath: v.modelFolderPath.trim(),
        description: v.description.trim(),
      });
      if (cover && cover.size > MAX_FILE_BYTES) {
        toast.show({ tone: 'error', message: t('files.tooBig', { name: cover.name }) });
      } else if (cover) {
        await api.call('files.upload', { projectId: detail.project.id, name: cover.name, blob: cover, stageId: detail.currentStage.id, asCover: true });
      }
      toast.show({ message: t('projectForm.created', { code: detail.project.code }) });
      onOpenChange(false);
      navigate(`/projects/${detail.project.id}`);
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('projectForm.createTitle')}
      wide
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="new-project" disabled={saving}>{t('projectForm.create')}</Button>
        </>
      )}
    >
      <form id="new-project" noValidate onSubmit={submit} className="flex flex-col gap-4 pt-2">
        <ProjectFields form={form} mode="create" />
        <div className="flex flex-col gap-1">
          <label htmlFor="project-cover" className="text-footnote text-label-2">{t('projectForm.cover')}</label>
          <input
            id="project-cover"
            type="file"
            accept="image/*"
            onChange={(event) => setCover(event.target.files?.[0] ?? null)}
            className="text-subheadline file:me-3 file:min-h-11 file:rounded-full file:border-0 file:bg-fill file:px-4 file:text-label"
          />
        </div>
      </form>
    </Sheet>
  );
}
