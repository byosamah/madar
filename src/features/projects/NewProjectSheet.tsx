import { shownKey } from '../../lib/projectLabel';
import { useCallback, useEffect, useState, type FormEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { tooLargeText, uploadErrorMessage, useFileLimit } from '../../app/files';
import { useLang } from '../../app/lang';
import { useSheetSteps } from '../../app/insight/useSheetSteps';
import { usePrefetchCall } from '../../app/prefetch';
import { useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { UploadBar } from '../files/Attachments';
import { codeInput } from './codeForm';
import { emptyProjectForm, areaValue } from './projectForm';
import { ProjectFields, useProjectForm } from './ProjectFields';
import { templateInput } from './templateForm';

function focusFirstError(): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/**
 * Starts the reads of the sheet. A press on the button that opens it calls this on pointerdown, so the answers are in the cache when
 * the sheet mounts its reads (performance audit 2026-10-21, DF-5). The sheet asks nothing while it is closed.
 */
export function usePrepareNewProject(): () => void {
  const prefetch = usePrefetchCall();
  return useCallback(() => {
    prefetch('settings.get', {});
    prefetch('projectTemplates.list', {});
    prefetch('projects.list', { status: 'all' });
  }, [prefetch]);
}

/** Anyone can create a project (spec 2.2). The name and the code parts are required (spec 4.4; owner, 2026-10-05). */
export function NewProjectSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { api } = useRuntime();
  const limit = useFileLimit();
  const lang = useLang();
  // Usage data for the owner: open, save, close with no save (insight design).
  const stepSaved = useSheetSteps('newProject', open);
  // A closed sheet reads nothing (DF-5). A read that no screen needs yet starts when the sheet opens, or on the press before it.
  const settings = useCall('settings.get', {}, { enabled: open });
  const templates = useCall('projectTemplates.list', {}, { enabled: open });
  const users = useCall('users.list', {});
  // The sub-companies of the office: when there are any, a new project needs one (fbk_007).
  const subCompanies = useCall('subCompanies.list', {});
  // The codes of the office, so a typed code that takes the series of another contract warns before Create (feedback fbk_003).
  const projects = useCall('projects.list', { status: 'all' }, { enabled: open });
  const defaults = settings.data?.defaultStages ?? [];
  const form = useProjectForm(emptyProjectForm(defaults), {
    create: true, templates: templates.data, projects: projects.data?.map((summary) => summary.project),
    subCompanies: (subCompanies.data ?? []).length > 0,
  });
  const [cover, setCover] = useState<File | null>(null);
  // The whole percent of the cover that goes up, or null when nothing goes up (fbk_045).
  const [coverPercent, setCoverPercent] = useState<number | null>(null);
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
    setCoverPercent(0);
    try {
      const onProgress = (sent: number, total: number) => setCoverPercent(total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0);
      await api.call('files.upload', { projectId, name: file.name, blob: file, stageId, asCover: true }, { onProgress });
    } catch (error) {
      toast.failed(error, { retry: () => void uploadCover(projectId, stageId, file), message: uploadErrorMessage(error, file.name, t, lang) });
    } finally {
      setCoverPercent(null);
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
      // An internal project sends none of the client fields and no code: the server gives the INT code and hides the project (fbk_044).
      const own = v.kind === 'internal'
        ? { kind: 'internal' as const }
        : {
          clientId: v.clientId || null,
          subCompanyId: v.subCompanyId || null,
          location: v.location.trim(),
          geo: v.geo,
          areaM2: areaValue(v.area),
          contractStartDate: v.contractStartDate || null,
          ...codeInput(v),
        };
      const detail = await api.call('projects.create', {
        name: v.name.trim(),
        leader: v.leader,
        ...plan,
        teamIds: v.teamIds,
        modelFolderPath: v.modelFolderPath.trim(),
        description: v.description.trim(),
        ...own,
      });
      // The key is short and never ends with the dot of a building type ("Dev."), so the sentence never shows two dots.
      toast.show({ message: t('projectForm.created', { code: shownKey(detail.project, t) }) });
      stepSaved();
      fresh.current = true;
      // The project exists now. The cover goes up on its own, so a failed upload never makes a second project. The sheet stays open
      // while the cover goes up, so the person sees its bar (fbk_045); a failed upload shows its toast with Retry after the sheet closes.
      // The limit of the active store (session.get), named, so a cover over it never starts an upload that the server refuses.
      if (cover && cover.size > limit) toast.show({ tone: 'error', message: tooLargeText(cover.name, limit, t, lang) });
      else if (cover) await uploadCover(detail.project.id, detail.currentStage.id, cover);
      onOpenChange(false);
      navigate(`/projects/${detail.project.id}`);
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
      <form id="new-project" noValidate autoComplete="off" onSubmit={submit} className="flex flex-col gap-4 pt-2">
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
          {cover && coverPercent !== null && <UploadBar name={cover.name} percent={coverPercent} />}
        </div>
      </form>
    </Sheet>
  );
}
