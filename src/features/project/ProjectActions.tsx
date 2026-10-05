import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { PauseKind, ProjectStatus } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField, TextArea, TextField } from '../../components/Fields';
import { Menu, type MenuItem } from '../../components/Menu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Sheet } from '../../components/Sheet';
import { fieldError } from '../../app/errors';
import { todayISO, addDays } from '../../lib/dates';
import { EditProjectSheet } from '../projects/EditProjectSheet';
import { projectKey } from '../../lib/projectCode';

type SheetProps = { detail: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * No Undo toast here: the old leader loses the right to undo it (plan clarification 6).
 * "pick" starts the sheet on one person, for "Make leader" in the Team tab: a pick, then Save (audit 2026-10-03, PRJ-21).
 */
export function LeaderSheet({ detail, open, onOpenChange, pick }: SheetProps & { pick?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const [leaderId, setLeaderId] = useState(detail.project.leaderId ?? '');
  useEffect(() => {
    if (open) setLeaderId(pick ?? detail.project.leaderId ?? '');
  }, [open, pick, detail.project.leaderId]);
  const change = useAction('projects.setLeader', {
    onSuccess: () => {
      toast.show({ message: t('project.leaderChanged') });
      onOpenChange(false);
    },
  });
  const people = (users.data ?? []).filter((user) => user.kind === 'human');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.changeLeader')}
      footer={<Button variant="primary" disabled={change.isPending} onClick={() => change.mutate({ id: detail.project.id, leaderId: leaderId || null })}>{t('common.save')}</Button>}
    >
      <SelectField id="change-leader" label={t('projectForm.leader')} value={leaderId} onChange={(event) => setLeaderId(event.target.value)}>
        <option value="">{t('projectForm.leaderNone')}</option>
        {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </SelectField>
    </Sheet>
  );
}

/** The only confirmation in the app (spec 10.7). */
function DeleteProjectSheet({ detail, open, onOpenChange }: SheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const remove = useAction('projects.delete', {
    onSuccess: () => {
      toast.show({ message: t('project.deleted') });
      onOpenChange(false);
      navigate('/projects');
    },
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.deleteTitle', { name: detail.project.name })}
      description={t('project.deleteBody')}
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate({ id: detail.project.id, confirm: true })}>
            {t('project.delete')}
          </Button>
        </>
      )}
    >
      <p dir="auto" className="tabular text-subheadline text-label-2">{projectKey(detail.project.code)} · {detail.project.name}</p>
    </Sheet>
  );
}

/** The leader pauses the project with a reason the team can read, and an optional restart date (owner, 2026-10-01). */
function PauseSheet({ detail, open, onOpenChange }: SheetProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [resumeOn, setResumeOn] = useState('');
  const [kind, setKind] = useState<PauseKind>('internal');
  useEffect(() => {
    if (!open) return;
    setReason('');
    setResumeOn('');
    setKind('internal');
  }, [open]);
  const pause = useUndoable('projects.pause', { message: () => t('project.pausedToast'), onSuccess: () => onOpenChange(false) });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.pauseTitle')}
      description={t('project.pauseHint')}
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!reason.trim() || pause.isPending} onClick={() => pause.mutate({ id: detail.project.id, reason: reason.trim(), resumeOn: resumeOn || null, kind })}>
            {t('project.pause')}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-1.5">
          <span className="field-label">{t('project.pauseWhy')}</span>
          <SegmentedControl
            label={t('project.pauseWhy')}
            value={kind}
            onChange={setKind}
            options={(['internal', 'client'] as const).map((value) => ({ value, label: t(`project.pauseKinds.${value}`) }))}
          />
          {kind === 'client' && <p className="text-caption text-ink-2">{t('project.pauseClientHint')}</p>}
        </div>
        <TextArea id="pause-reason" label={t('project.pauseReason')} value={reason} dir="auto" maxLength={280} error={fieldError(pause.error, 'reason', t, t('errors.invalid_input'))} onChange={(event) => setReason(event.target.value)} />
        <TextField id="pause-resume" type="date" label={t('project.resumeOn')} min={addDays(todayISO(), 1)} value={resumeOn} error={fieldError(pause.error, 'resumeOn', t, t('errors.invalid_input'))} onChange={(event) => setResumeOn(event.target.value)} />
      </div>
    </Sheet>
  );
}

/** The "…" menu next to the main button: Edit, Change leader, the status changes and Delete (spec 5.1). */
export function ProjectActions({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<'edit' | 'leader' | 'delete' | 'pause' | null>(null);
  const status = useUndoable('projects.setStatus', { message: () => t('project.statusChanged') });
  const resume = useUndoable('projects.resume', { message: () => t('project.resumedToast') });
  const { project, viewerCan } = detail;
  // A paused project comes back with Resume, so "Reopen" shows only for a completed or archived project.
  const statusItem = (to: ProjectStatus): MenuItem => ({
    label: t(`project.statusTo.${to}`),
    onSelect: () => status.mutate({ id: project.id, status: to }),
    hidden: !viewerCan.archive || project.status === to || (to === 'active' && project.status === 'on_hold'),
  });
  const items: MenuItem[] = [
    { label: t('project.edit'), onSelect: () => setSheet('edit'), hidden: !viewerCan.edit },
    { label: t('project.changeLeader'), onSelect: () => setSheet('leader'), hidden: !viewerCan.changeLeader },
    { label: t('project.pause'), onSelect: () => setSheet('pause'), hidden: !viewerCan.archive || project.status !== 'active' },
    // The paused banner has the Resume button, so the menu offers it only when no banner shows (audit 2026-10-03, PRJ-20).
    { label: t('project.resume'), onSelect: () => resume.mutate({ id: project.id }), hidden: !viewerCan.archive || project.status !== 'on_hold' || Boolean(project.pause) },
    statusItem('active'),
    statusItem('completed'),
    statusItem('archived'),
    { label: t('project.delete'), onSelect: () => setSheet('delete'), hidden: !viewerCan.delete, destructive: true },
  ];
  const onOpenChange = (open: boolean) => {
    if (!open) setSheet(null);
  };
  return (
    <>
      <Menu label={t('project.more')} items={items} triggerClassName="bg-fill text-ink hover:bg-fill-strong" />
      <EditProjectSheet detail={detail} open={sheet === 'edit'} onOpenChange={onOpenChange} />
      <LeaderSheet detail={detail} open={sheet === 'leader'} onOpenChange={onOpenChange} />
      <DeleteProjectSheet detail={detail} open={sheet === 'delete'} onOpenChange={onOpenChange} />
      <PauseSheet detail={detail} open={sheet === 'pause'} onOpenChange={onOpenChange} />
    </>
  );
}
