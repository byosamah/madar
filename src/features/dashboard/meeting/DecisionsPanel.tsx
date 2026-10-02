import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../../app/lang';
import { useMeeting } from '../../../app/meeting';
import { useAction, useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { addWorkingDays } from '../../../lib/workdays';
import { formatDay, todayISO } from '../../../lib/dates';
import { plainText } from '../../../lib/text';

const HEADING = 'text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2';

type Kind = 'decision' | 'action';

/** One line of text and an Add button. A decision posts to the Activity of the project, and never to the Tracker. */
function DecisionForm({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const post = useAction('updates.create', { onSuccess: () => setText('') });
  return (
    <form
      className="flex items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() && !post.isPending) post.mutate({ projectId, body: text.trim(), decision: true });
      }}
    >
      <TextField id={`meeting-decision-${projectId}`} label={t('dashboard.meeting.writeDecision')} dir="auto" value={text} onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1" />
      <Button variant="primary" type="submit" disabled={!text.trim() || post.isPending}>{t('common.add')}</Button>
    </form>
  );
}

/** A title, a person from the team and a due date. The task goes in the current stage. It is a first date, so no date reason is asked. */
function ActionForm({ projectId, stageId, members, defaultUserId }: { projectId: string; stageId: string; members: { id: string; name: string }[]; defaultUserId: string }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [userId, setUserId] = useState('');
  const [dueDate, setDueDate] = useState(() => addWorkingDays(todayISO(), 2));
  const create = useAction('tasks.create', { onSuccess: () => setTitle('') });
  const who = userId || defaultUserId;
  const ready = title.trim() !== '' && who !== '' && dueDate !== '' && !create.isPending;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) create.mutate({ projectId, stageId, title: title.trim(), ownerId: who, dueDate });
      }}
    >
      <TextField id={`meeting-action-${projectId}`} label={t('dashboard.meeting.writeAction')} dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField id={`meeting-action-who-${projectId}`} label={t('dashboard.meeting.actionWho')} value={who} onChange={(event) => setUserId(event.target.value)} className="min-w-44 flex-1">
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </SelectField>
        <TextField id={`meeting-action-by-${projectId}`} type="date" label={t('dashboard.meeting.actionBy')} value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="min-w-40" />
        <Button variant="primary" type="submit" disabled={!ready}>{t('common.add')}</Button>
      </div>
    </form>
  );
}

/**
 * The decisions and the actions of one project, for the meeting (owner, 2026-10-02). A decision is a project update with the
 * decision flag. An action is a task. The list holds what people added since the meeting started, the newest last.
 * The input shows only what the viewer may do. With no input and no list, the panel is not there.
 */
export function DecisionsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const startedAt = useMeeting()?.startedAt ?? '';
  const detail = useCall('projects.get', { id: projectId });
  const posts = useCall('updates.list', { projectId, filter: 'posts' });
  const tasks = useCall('tasks.list', { projectId });
  const me = useCall('session.get', {}).data?.user.id;
  const [picked, setPicked] = useState<Kind>('decision');
  const canDecide = detail.data?.viewerCan.post === true;
  const canAct = detail.data?.viewerCan.createTaskForAnyone === true;
  const kind: Kind = picked === 'action' && canAct ? 'action' : canDecide ? 'decision' : 'action';
  const lines = [
    ...(posts.data ?? []).flatMap((item) => (item.kind === 'update' && item.decision && item.at >= startedAt ? [{ id: item.id, at: item.at, text: plainText(item.body) }] : [])),
    ...(tasks.data ?? []).flatMap((row) => (row.task.createdAt >= startedAt
      ? [{ id: row.task.id, at: row.task.createdAt, text: t('dashboard.meeting.actionLine', { title: row.task.title, name: row.owner.name, date: row.task.dueDate ? formatDay(row.task.dueDate, lang, 'withWeekday') : '' }) }]
      : [])),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (!canDecide && !canAct && lines.length === 0) return null;
  const members = (detail.data?.members ?? []).map((member) => member.user);
  const defaultUserId = members.some((member) => member.id === me) ? me ?? '' : members[0]?.id ?? '';
  return (
    <section aria-label={t('dashboard.meeting.decisions')} className="panel flex flex-col gap-3 p-5">
      <h3 className={HEADING}>{t('dashboard.meeting.decisions')}</h3>
      {canDecide && canAct && (
        <div role="group" aria-label={t('dashboard.meeting.entryKind')} className="flex gap-2">
          <Button variant={kind === 'decision' ? 'primary' : 'secondary'} aria-pressed={kind === 'decision'} onClick={() => setPicked('decision')}>{t('dashboard.meeting.kindDecision')}</Button>
          <Button variant={kind === 'action' ? 'primary' : 'secondary'} aria-pressed={kind === 'action'} onClick={() => setPicked('action')}>{t('dashboard.meeting.kindAction')}</Button>
        </div>
      )}
      {kind === 'decision' && canDecide && <DecisionForm projectId={projectId} />}
      {kind === 'action' && canAct && detail.data && <ActionForm projectId={projectId} stageId={detail.data.project.currentStageId} members={members} defaultUserId={defaultUserId} />}
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {lines.map((line) => <li key={line.id} dir="auto" className="text-[17px] text-ink">{line.text}</li>)}
        </ul>
      )}
    </section>
  );
}
