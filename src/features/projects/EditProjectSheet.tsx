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
    nameAr: project.nameAr ?? '',
    kind: project.kind ?? 'client',
    clientId: project.clientId ?? '',
    subCompanyId: project.subCompanyId ?? '',
    leader: 'me',
    location: project.location,
    // The pin of the summary: old data shows the place of its location link, and a save then keeps it as the pin (PRJ-04).
    geo: detail.geo ?? null,
    area: project.areaM2 === null ? '' : String(project.areaM2),
    contractStartDate: project.contractStartDate ?? '',
    startDate: project.startDate ?? '',
    targetEndDate: project.targetEndDate ?? '',
    continuous: project.continuous === true,
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
  // The stage names are saved by stages.replace, which asks project.stages (role rights version 2).
  const editStages = detail.viewerCan.editStages === true;
  // The codes of the office, so a corrected code that takes the series of another contract warns (feedback fbk_003).
  // A closed sheet reads nothing (DF-5): the menu item starts this read on its press (ProjectActions).
  const projects = useCall('projects.list', { status: 'all' }, { enabled: editCode && open });
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
    // The sub-company goes only when the person changed it, so a list that has not loaded never clears it (fbk_007).
    const subCompanyId = v.subCompanyId || null;
    const subCompanyPatch = subCompanyId !== (detail.project.subCompanyId ?? null) ? { subCompanyId } : {};
    setSaving(true);
    try {
      await api.call('projects.update', {
        id: detail.project.id,
        patch: {
          name: v.name.trim(),
          nameAr: v.nameAr.trim(),
          clientId: v.clientId || null,
          ...subCompanyPatch,
          location: v.location.trim(),
          geo: v.geo,
          areaM2: areaValue(v.area),
          contractStartDate: v.contractStartDate || null,
          startDate: v.startDate || null,
          targetEndDate: v.continuous ? null : v.targetEndDate || null,
          // Sent only when the person changed it, so a save never writes the switch by mistake (fbk_069).
          ...(v.continuous !== (detail.project.continuous === true) ? { continuous: v.continuous } : {}),
          modelFolderPath: v.modelFolderPath.trim(),
          description: v.description.trim(),
          ...(code !== undefined ? { code } : {}),
        },
        // The tick "Use this code anyway" keeps a code outside the office pattern (feedback fbk_003).
        ...(code !== undefined && v.codeAnyway ? { codeAnyway: true } : {}),
      }, meta);
      const before = JSON.stringify(detail.stages.map((stage) => [stage.id, stage.name]));
      const after = JSON.stringify(v.stages.map((stage) => [stage.id ?? null, stage.name.trim()]));
      if (editStages && before !== after) {
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
      <form id="edit-project" noValidate autoComplete="off" onSubmit={submit} className="pt-2">
        <ProjectFields form={form} mode="edit" editCode={editCode} editStages={editStages} />
      </form>
    </Sheet>
  );
}
