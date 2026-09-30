import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ProjectStatus } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField } from '../../components/Fields';
import { Menu, type MenuItem } from '../../components/Menu';
import { Sheet } from '../../components/Sheet';
import { EditProjectSheet } from '../projects/EditProjectSheet';

type SheetProps = { detail: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void };

/** No Undo toast here: the old leader loses the right to undo it (plan clarification 6). */
function LeaderSheet({ detail, open, onOpenChange }: SheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const [leaderId, setLeaderId] = useState(detail.project.leaderId ?? '');
  useEffect(() => {
    if (open) setLeaderId(detail.project.leaderId ?? '');
  }, [open, detail.project.leaderId]);
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
      navigate('/');
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
      <p dir="auto" className="tabular text-subheadline text-label-2">{detail.project.code} · {detail.project.name}</p>
    </Sheet>
  );
}

/** The "…" menu over the cover: Edit, Change leader, the status changes and Delete (spec 5.1). */
export function ProjectActions({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<'edit' | 'leader' | 'delete' | null>(null);
  const status = useUndoable('projects.setStatus', { message: () => t('project.statusChanged') });
  const { project, viewerCan } = detail;
  const statusItem = (to: ProjectStatus): MenuItem => ({
    label: t(`project.statusTo.${to}`),
    onSelect: () => status.mutate({ id: project.id, status: to }),
    hidden: !viewerCan.archive || project.status === to,
  });
  const items: MenuItem[] = [
    { label: t('project.edit'), onSelect: () => setSheet('edit'), hidden: !viewerCan.edit },
    { label: t('project.changeLeader'), onSelect: () => setSheet('leader'), hidden: !viewerCan.changeLeader },
    statusItem('active'),
    statusItem('on_hold'),
    statusItem('completed'),
    statusItem('archived'),
    { label: t('project.delete'), onSelect: () => setSheet('delete'), hidden: !viewerCan.delete, destructive: true },
  ];
  const onOpenChange = (open: boolean) => {
    if (!open) setSheet(null);
  };
  return (
    <>
      <Menu label={t('project.more')} items={items} triggerClassName="glass-media" />
      <EditProjectSheet detail={detail} open={sheet === 'edit'} onOpenChange={onOpenChange} />
      <LeaderSheet detail={detail} open={sheet === 'leader'} onOpenChange={onOpenChange} />
      <DeleteProjectSheet detail={detail} open={sheet === 'delete'} onOpenChange={onOpenChange} />
    </>
  );
}
