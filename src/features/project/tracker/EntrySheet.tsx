import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TRACKER_TYPES, type TrackerDirection, type TrackerType } from '../../../api/contract/entities';
import type { ProjectDetail, TrackerRow, UserCard } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useAction, useCall } from '../../../app/runtime';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { NoLeadMark } from '../../../components/NoLeadMark';
import { Button } from '../../../components/Button';
import { DateField } from '../../../components/DateField';
import { TextArea, TextField } from '../../../components/Fields';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Sheet } from '../../../components/Sheet';
import { StatusSign } from '../../../components/StatusSign';
import { Switch } from '../../../components/Switch';
import { formatDay, stampDay } from '../../../lib/dates';
import { actorContext } from '../../../lib/grammar';
import { AUTO_KEY, isOpen, activeMembers, sideForType, waitingFor } from '../../../lib/tracker';
import { FileChips } from '../../files/Attachments';
import { DirectionPicker, waitLabelKey } from './formParts';
import { ReplyFields } from './ReplyFields';
import { defaultReplier, defaultReplyDay, repliers, useReplyRights } from './replyRights';
import { DirectionMark, TypeIcon } from './marks';
import { useCloseLoop } from './useCloseLoop';
import { taskLink } from '../../../lib/params';
import { meetingLink } from '../../../lib/meetings';
import { AddMinutes, MinutesBody, QUIET } from '../../meetings/MinutesPart';
import { MinutesSheet } from '../../meetings/MinutesSheet';

/** A reply task whose lead was taken off (owner, 2026-10-05): the dashed mark and the words, where the person goes. */
function NoLead() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex min-h-8 items-center gap-2">
      <NoLeadMark size={24} />
      <span className="text-subheadline text-ink-2">{t('lead.noLead')}</span>
    </span>
  );
}

function Person({ user }: { user: UserCard }) {
  const nameOf = usePersonName();
  return (
    <span className="inline-flex min-h-8 items-center gap-2">
      <Avatar user={user} size={24} />
      <bdi className="text-subheadline">{nameOf(user)}</bdi>
      {user.kind === 'agent' && <AgentLabel />}
    </span>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 pt-4">
      <h3 className="text-footnote font-semibold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

function EditForm({ row, detail, onDone }: { row: TrackerRow; detail: ProjectDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const { entry } = row;
  const [title, setTitle] = useState(entry.title);
  const [note, setNote] = useState(entry.note);
  const [date, setDate] = useState(entry.date);
  const [type, setType] = useState<TrackerType>(entry.type);
  const [direction, setDirection] = useState<TrackerDirection>(entry.direction);
  const [wait, setWait] = useState(entry.waiting !== null);
  const [peopleIds, setPeopleIds] = useState(entry.peopleIds);
  const save = useAction('tracker.update', { onSuccess: onDone });
  const options = [...detail.members.map((member) => member.user), ...row.people.filter((p) => !detail.members.some((m) => m.user.id === p.id))];
  const submit = () => {
    if (!title.trim() || save.isPending) return;
    // The loop stays as it is when neither the switch nor the direction changed. Otherwise it follows the direction.
    const untouched = wait === (entry.waiting !== null) && direction === entry.direction;
    const waiting = untouched ? entry.waiting : wait ? waitingFor(direction) : null;
    save.mutate({ id: entry.id, title, note, date: date || entry.date, type, direction, peopleIds, waiting });
  };
  return (
    <form
      className="flex flex-col gap-4 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextField id="tracker-edit-title" label={t('tracker.titleField')} dir="auto" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
      <TextArea id="tracker-edit-note" label={t('tracker.noteField')} dir="auto" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="flex flex-wrap gap-3">
        <SegmentedControl
          label={t('tracker.typeLabel')}
          value={type}
          options={TRACKER_TYPES.map((value) => ({ value, label: t(`tracker.type.${value}`) }))}
          onChange={(value) => {
            setType(value);
            setDirection(sideForType(value, direction));
          }}
        />
        <DirectionPicker type={type} direction={direction} onChange={setDirection} />
      </div>
      <DateField id="tracker-edit-date" label={t('tracker.date')} clearable={false} value={date} onChange={setDate} />
      <Switch id="tracker-edit-wait" label={t(waitLabelKey(direction))} checked={wait} onChange={setWait} />
      <fieldset className="flex flex-col">
        <legend className="field-label pb-1">{t('tracker.peopleField')}</legend>
        {options.map((user) => (
          <label key={user.id} className="flex min-h-11 items-center gap-3 text-body text-ink">
            <input
              type="checkbox"
              checked={peopleIds.includes(user.id)}
              onChange={(event) => setPeopleIds((ids) => (event.target.checked ? [...ids, user.id] : ids.filter((id) => id !== user.id)))}
              className="size-5 accent-[var(--sig-from)]"
            />
            <bdi>{nameOf(user)}</bdi>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={!title.trim() || save.isPending}>{t('common.save')}</Button>
      </div>
    </form>
  );
}

/** "Assign a reply" for an open entry that waits for our reply and has no reply task: who answers, and by which day. */
function AssignReply({ row, members: everyone, canAssign }: { row: TrackerRow; members: UserCard[]; canAssign: boolean }) {
  const { t } = useTranslation();
  const me = useCall('session.get', {}).data?.user.id;
  const members = repliers(everyone, me, canAssign);
  const [asking, setAsking] = useState(false);
  const [userId, setUserId] = useState('');
  const [dueDate, setDueDate] = useState(defaultReplyDay);
  const assign = useUndoable('tracker.assignReply', { message: () => t('tracker.replyAssigned'), onSuccess: () => setAsking(false) });
  const who = userId || defaultReplier(members, me);
  if (!asking) return <p className="pt-3"><Button onClick={() => setAsking(true)}>{t('tracker.assignReply')}</Button></p>;
  return (
    <div className="flex flex-col gap-3 pt-3">
      <ReplyFields id="tracker-assign" members={members} userId={who} dueDate={dueDate} onUser={setUserId} onDueDate={setDueDate} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => setAsking(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!who || !dueDate || assign.isPending} onClick={() => assign.mutate({ id: row.entry.id, userId: who, dueDate })}>{t('tracker.assign')}</Button>
      </div>
    </div>
  );
}

/** The quiet link from the line of a meeting to the meeting itself (wave 2). */
function OpenMeeting({ id }: { id: string }) {
  const { t } = useTranslation();
  return <Link to={meetingLink(id)} className={QUIET}>{t('minutes.openMeeting')}</Link>;
}

/**
 * One entry in full: the note, the people, the files, who logged it and when, with close, edit and delete. The line that Madar made for a
 * meeting that ended also holds the minutes of that meeting (wave 2): any attendee writes them here, with one quiet button.
 */
export function EntrySheet({ row, detail, onClose }: { row: TrackerRow; detail: ProjectDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const [editing, setEditing] = useState(false);
  const [writing, setWriting] = useState(false);
  const { close, action } = useCloseLoop(row);
  const remove = useUndoable('tracker.delete', { message: () => t('tracker.deleted'), onSuccess: onClose });
  const { entry } = row;
  const { canReply, canAssign } = useReplyRights(detail);
  const open = isOpen(entry);
  const footer = !editing && (
    <>
      {row.canDelete && <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate({ id: entry.id })}>{t('common.delete')}</Button>}
      {row.canEdit && <Button onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
      {row.canClose && <Button variant="primary" disabled={close.isPending} onClick={() => close.mutate({ id: entry.id })}>{action}</Button>}
    </>
  );
  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }} title={entry.title} footer={footer}>
      {editing ? <EditForm row={row} detail={detail} onDone={() => setEditing(false)} /> : (
        <div className="flex flex-col">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-subheadline text-ink-2">
            <span className="inline-flex items-center gap-1.5"><TypeIcon type={entry.type} size={16} />{t(`tracker.type.${entry.type}`)}</span>
            {entry.direction !== 'none' && <span className="inline-flex items-center gap-1.5"><DirectionMark direction={entry.direction} spoken={false} />{t(`tracker.direction.${entry.direction}`)}</span>}
            <span className="tabular">{formatDay(entry.date, lang, 'long')}</span>
          </p>
          {open && <p className="pt-3"><StatusSign state="active">{t(entry.waiting === 'us' ? 'tracker.waitingUs' : 'tracker.waitingClient')}</StatusSign></p>}
          {row.replyTask && (
            <Block title={t('tracker.replyTask')}>
              {/* The block names the reply task and opens its panel, so the next step is one press (audit 2026-10-03, F-11). */}
              <Link
                to={taskLink(detail.project.id, row.replyTask.id)}
                className="pressable -mx-2 flex flex-col gap-1 rounded-xl px-2 py-1.5 hover:bg-fill"
              >
                <span dir="auto" className="text-subheadline font-semibold text-link">{row.replyTask.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-subheadline">
                  {row.replyTask.owner ? <Person user={row.replyTask.owner} /> : <NoLead />}
                  {row.replyTask.dueDate && <span className="tabular text-ink-2">{t('tracker.replyDue', { date: formatDay(row.replyTask.dueDate, lang) })}</span>}
                  {row.replyTask.status === 'done' && <StatusSign state="completed">{t('tracker.replyDone')}</StatusSign>}
                </span>
              </Link>
            </Block>
          )}
          {open && entry.waiting === 'us' && row.canEdit && canReply && (!row.replyTask || row.replyTask.status === 'done') && <AssignReply row={row} members={activeMembers(detail.members)} canAssign={canAssign} />}
          {!open && entry.waiting !== null && row.closedBy && entry.closedAt && (
            <p className="flex flex-wrap items-center gap-2 pt-3">
              <StatusSign state="completed">{action}</StatusSign>
              <span className="text-footnote text-ink-2">
                {t('tracker.closedBy', { name: nameOf(row.closedBy), date: formatDay(stampDay(entry.closedAt), lang), context: actorContext(row.closedBy) })}
              </span>
            </p>
          )}
          {entry.note && <Block title={t('tracker.note')}><p dir="auto" className="whitespace-pre-wrap text-body">{entry.note}</p></Block>}
          {row.people.length > 0 && <Block title={t('tracker.people')}><ul className="flex flex-wrap gap-x-4">{row.people.map((user) => <li key={user.id}><Person user={user} /></li>)}</ul></Block>}
          {row.files.length > 0 && <Block title={t('tracker.files')}><FileChips files={row.files} /></Block>}
          {row.meeting && (row.minutes || row.canEditMinutes) && (
            <Block title={t('minutes.title')}>
              {row.minutes
                ? <MinutesBody minutes={row.minutes} canEdit={row.canEditMinutes ?? false} onEdit={() => setWriting(true)} className="text-body"><OpenMeeting id={row.meeting.id} /></MinutesBody>
                : <div className="flex flex-wrap items-center gap-x-5"><AddMinutes onClick={() => setWriting(true)} /><OpenMeeting id={row.meeting.id} /></div>}
            </Block>
          )}
          {row.meeting && !row.minutes && !row.canEditMinutes && <div className="pt-3"><OpenMeeting id={row.meeting.id} /></div>}
          <div className="flex flex-col gap-1 pt-5 text-footnote text-ink-2">
            <p>
              {t('tracker.loggedBy', { name: nameOf(row.createdBy), date: formatDay(stampDay(entry.createdAt), lang), context: actorContext(row.createdBy) })}
              {row.createdBy.kind === 'agent' && <> <AgentLabel /></>}
            </p>
            {entry.auto && AUTO_KEY[entry.auto] && <p>{t(AUTO_KEY[entry.auto] as string)}</p>}
          </div>
        </div>
      )}
      {writing && row.meeting && (
        <MinutesSheet meeting={{ id: row.meeting.id, title: row.meeting.title, projectId: entry.projectId }} minutes={row.minutes ?? null} onClose={() => setWriting(false)} />
      )}
    </Sheet>
  );
}
