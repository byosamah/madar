import { projectKey } from '../../lib/projectCode';
import { useEffect, useState, type FormEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { tooLargeText, uploadErrorMessage, useFileLimit } from '../../app/files';
import { useLang } from '../../app/lang';
import { useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { codeInput } from './codeForm';
import { emptyProjectForm, areaValue } from './projectForm';
import { ProjectFields, useProjectForm } from './ProjectFields';
import { templateInput } from './templateForm';

function focusFirstError(): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/** Anyone can create a project (spec 2.2). The name and the code parts are required (spec 4.4; owner, 2026-10-05). */
export function NewProjectSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { api } = useRuntime();
  const limit = useFileLimit();
  const lang = useLang();
  const settings = useCall('settings.get', {});
  const templates = useCall('projectTemplates.list', {});
  const users = useCall('users.list', {});
  const defaults = settings.data?.defaultStages ?? [];
  const form = useProjectForm(emptyProjectForm(defaults), { create: true, templates: templates.data });
  const [cover, setCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // A sheet closed by accident (Escape, a tap outside, a swipe) keeps what the person typed, for as long as this screen lives.
  // Only Cancel and a created project start the next form empty (audit PER-8: nothing loses work by accident).
  const fresh = useRef(true);
  useEffect(() => {
    if (!open || !fresh.current) return;
    fresh.current = false;
    form.reset(emptyProjectForm(settings.data?.defaultStages ?? []));
    setCover(null);
    // A settings change while it is open must not erase what the person typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cancel = () => {
    fresh.current = true;
    onOpenChange(false);
  };

  useEffect(() => {
    // The default stages can arrive after the sheet opens. They fill the stage list only while it is still empty.
    if (open && settings.data && form.values.stages.length === 0) form.set('stages', settings.data.defaultStages.map((name) => ({ name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.data]);

  const uploadCover = async (projectId: string, stageId: string, file: File): Promise<void> => {
    try {
      await api.call('files.upload', { projectId, name: file.name, blob: file, stageId, asCover: true });
    } catch (error) {
      toast.failed(error, { retry: () => void uploadCover(projectId, stageId, file), message: uploadErrorMessage(error, file.name, t, lang) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.check()) {
      focusFirstError();
      return;
    }
    const v = form.values;
    // A template gives the stages and the dates (owner, 2026-10-05, item 6a). Without one, the stage list and the dates go as before.
    const template = v.templateId ? templates.data?.find((t) => t.id === v.templateId) : undefined;
    const plan = template
      ? { template: templateInput(template, v, users.data ?? []) }
      : { startDate: v.startDate || null, targetEndDate: v.targetEndDate || null, stages: v.stages.map((stage) => stage.name.trim()) };
    setSaving(true);
    try {
      const detail = await api.call('projects.create', {
        name: v.name.trim(),
        clientId: v.clientId || null,
        leader: v.leader,
        location: v.location.trim(),
        areaM2: areaValue(v.area),
        contractStartDate: v.contractStartDate || null,
        ...plan,
        teamIds: v.teamIds,
        modelFolderPath: v.modelFolderPath.trim(),
        description: v.description.trim(),
        ...codeInput(v),
      });
      // The key is short and never ends with the dot of a building type ("Dev."), so the sentence never shows two dots.
      toast.show({ message: t('projectForm.created', { code: projectKey(detail.project.code) }) });
      fresh.current = true;
      onOpenChange(false);
      navigate(`/projects/${detail.project.id}`);
      // The project exists now. The cover goes up on its own, so a failed upload never makes a second project.
      // The limit of the active store (session.get), named, so a cover over it never starts an upload that the server refuses.
      if (cover && cover.size > limit) toast.show({ tone: 'error', message: tooLargeText(cover.name, limit, t, lang) });
      else if (cover) void uploadCover(detail.project.id, detail.currentStage.id, cover);
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
      title={t('projectForm.createTitle')}
      wide
      footer={(
        <>
          <Button onClick={cancel}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="new-project" disabled={saving}>{t('projectForm.create')}</Button>
        </>
      )}
    >
      <form id="new-project" noValidate onSubmit={submit} className="flex flex-col gap-4 pt-2">
        <ProjectFields form={form} mode="create" templates={templates.data ?? []} />
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
