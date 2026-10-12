import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { normalizeTypedCode } from '../../lib/projectCode';
import { emptyCodeValues } from './codeForm';
import type { ProjectFormValues } from './projectForm';
import { areaValue, emptyTemplateChoice } from './projectForm';
import { ProjectFields, useProjectForm } from './ProjectFields';

function valuesOf(detail: ProjectDetail): ProjectFormValues {
  const { project } = detail;
  return {
    name: project.name,
    clientId: project.clientId ?? '',
    leader: 'me',
    location: project.location,
    area: project.areaM2 === null ? '' : String(project.areaM2),
    contractStartDate: project.contractStartDate ?? '',
    startDate: project.startDate ?? '',
    targetEndDate: project.targetEndDate ?? '',
    stages: detail.stages.map((stage) => ({ id: stage.id, name: stage.name })),
    teamIds: [],
    modelFolderPath: project.modelFolderPath,
    description: project.description,
    code: project.code,
    ...emptyCodeValues(),
    ...emptyTemplateChoice(),
  };
}

export function EditProjectSheet({ detail, open, onOpenChange }: { detail: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  // Only the Admin corrects the code (owner, 2026-10-05). For everyone else the code is not in the form.
  const editCode = detail.viewerCan.editCode === true;
  // The codes of the office, so a corrected code that takes the series of another contract warns (feedback fbk_003).
  const projects = useCall('projects.list', { status: 'all' }, { enabled: editCode });
  const form = useProjectForm(valuesOf(detail), { editCode, project: detail.project, projects: projects.data?.map((summary) => summary.project) });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) form.reset(valuesOf(detail));
    // The form starts from the saved project each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.check()) return;
    const v = form.values;
    const meta = { correlationId: newStoryId() };
    // A corrected code goes only when the Admin changed it, so a save by the Admin never records a code change by mistake.
    const code = editCode && normalizeTypedCode(v.code) !== detail.project.code ? normalizeTypedCode(v.code) : undefined;
    setSaving(true);
    try {
      await api.call('projects.update', {
        id: detail.project.id,
        patch: {
          name: v.name.trim(),
          clientId: v.clientId || null,
          location: v.location.trim(),
          areaM2: areaValue(v.area),
          contractStartDate: v.contractStartDate || null,
          startDate: v.startDate || null,
          targetEndDate: v.targetEndDate || null,
          modelFolderPath: v.modelFolderPath.trim(),
          description: v.description.trim(),
          ...(code !== undefined ? { code } : {}),
        },
        // The tick "Use this code anyway" keeps a code outside the office pattern (feedback fbk_003).
        ...(code !== undefined && v.codeAnyway ? { codeAnyway: true } : {}),
      }, meta);
      const before = JSON.stringify(detail.stages.map((stage) => [stage.id, stage.name]));
      const after = JSON.stringify(v.stages.map((stage) => [stage.id ?? null, stage.name.trim()]));
      if (before !== after) {
        await api.call('stages.replace', {
          projectId: detail.project.id,
          stages: v.stages.map((stage) => {
            const old = detail.stages.find((s) => s.id === stage.id);
            return { id: stage.id, name: stage.name.trim(), startDate: old?.startDate ?? null, endDate: old?.endDate ?? null };
          }),
        }, meta);
      }
      toast.show({ message: t('projectForm.saved') });
      onOpenChange(false);
    } catch (error) {
      toast.failed(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('projectForm.editTitle')}
      wide
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="edit-project" disabled={saving}>{t('projectForm.save')}</Button>
        </>
      )}
    >
      <form id="edit-project" noValidate onSubmit={submit} className="pt-2">
        <ProjectFields form={form} mode="edit" editCode={editCode} />
      </form>
    </Sheet>
  );
}
