import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useMeeting } from '../../../app/meeting';
import { useUndoable } from '../../../app/actions';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { addWorkingDays } from '../../../lib/workdays';
import { todayISO } from '../../../lib/dates';
import { plainText } from '../../../lib/text';
import { actionLine } from './actionLine';
import { activeMembers } from '../../../lib/tracker';

const HEADING = 'text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2';

type Kind = 'decision' | 'action';

/**
 * A value that the person typed and did not add yet. The meeting keeps it, so Done, Skip, the keys and the Decision/Action
 * choice never throw it away (audit 2026-10-03, DSH-3). Outside a meeting it is plain state.
 */
function useDraft<T extends string>(key: string, initial: () => T): [T, (value: T) => void] {
  const drafts = useMeeting()?.drafts;
  const [value, setValue] = useState(() => (drafts?.get(key) as T | undefined) ?? initial());
  const set = (next: T) => {
    drafts?.set(key, next);
    setValue(next);
  };
  return [value, set];
}

/** One line of text and an Add button. A decision posts to the Activity of the project, and never to the Tracker. */
function DecisionForm({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [text, setText] = useDraft<string>(`decision:${projectId}`, () => '');
  // The app's Undo toast confirms the decision and gives a way back (browser audit 2026-10-03, BRW-14).
  const post = useUndoable('updates.create', { message: () => t('dashboard.meeting.decisionAdded'), onSuccess: () => setText('') });
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
function ActionForm({ projectId, stageId, members, defaultUserId }: { projectId: string; stageId: string; members: { id: string; name: string; nameAr?: string }[]; defaultUserId: string }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const [title, setTitle] = useDraft<string>(`action:${projectId}`, () => '');
  const [userId, setUserId] = useDraft<string>(`actionWho:${projectId}`, () => '');
  const [dueDate, setDueDate] = useDraft<string>(`actionBy:${projectId}`, () => addWorkingDays(todayISO(), 2));
  // An action makes a real task for a person, so the toast says for whom, and Undo takes it back (browser audit 2026-10-03, BRW-14).
  const create = useUndoable('tasks.create', { message: (task) => t('dashboard.meeting.actionAdded', { name: task.owner ? nameOf(task.owner) : t('lead.noLead') }), onSuccess: () => setTitle('') });
  // A pick that left the list (the person turned inactive) gives way to the default.
  const who = members.some((member) => member.id === userId) ? userId : defaultUserId;
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
          {members.map((member) => <option key={member.id} value={member.id}>{nameOf(member)}</option>)}
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
  const nameOf = usePersonName();
  const startedAt = useMeeting()?.startedAt ?? '';
  const detail = useCall('projects.get', { id: projectId });
  const posts = useCall('updates.list', { projectId, filter: 'posts' });
  // A paused project is in the meeting too, so its tasks count here (audit 2026-10-03, DSH-5).
  const tasks = useCall('tasks.list', { projectId, activeProjectsOnly: false });
  const me = useCall('session.get', {}).data?.user.id;
  const [picked, setPicked] = useDraft<Kind>(`kind:${projectId}`, () => 'decision');
  const canDecide = detail.data?.viewerCan.post === true;
  const canAct = detail.data?.viewerCan.createTaskForAnyone === true;
  const kind: Kind = picked === 'action' && canAct ? 'action' : canDecide ? 'decision' : 'action';
  const lines = [
    ...(posts.data ?? []).flatMap((item) => (item.kind === 'update' && item.decision && item.at >= startedAt ? [{ id: item.id, at: item.at, text: plainText(item.body) }] : [])),
    ...(tasks.data ?? []).flatMap((row) => (row.task.createdAt >= startedAt
      ? [{ id: row.task.id, at: row.task.createdAt, text: actionLine(t, lang, row.task.title, row.owner ? nameOf(row.owner) : t('lead.noLead'), row.task.dueDate) }]
      : [])),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  if (!canDecide && !canAct && lines.length === 0) return null;
  // The API refuses a task for an inactive person (API-7), so Who leaves them out (audit 2026-10-03, V-4c).
  const members = activeMembers(detail.data?.members ?? []);
  const defaultUserId = members.some((member) => member.id === me) ? me ?? '' : members[0]?.id ?? '';
  return (
    <section aria-label={t('dashboard.meeting.decisions')} className="panel flex flex-col gap-3 p-5">
      <h3 className={HEADING}>{t('dashboard.meeting.decisions')}</h3>
      {/* One choice, like every other choice in the meeting. Two filled buttons here competed with Done (the ADHD pass). */}
      {canDecide && canAct && (
        <SegmentedControl
          label={t('dashboard.meeting.entryKind')}
          value={kind}
          onChange={setPicked}
          options={[{ value: 'decision', label: t('dashboard.meeting.kindDecision') }, { value: 'action', label: t('dashboard.meeting.kindAction') }]}
        />
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
