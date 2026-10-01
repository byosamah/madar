import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TRACKER_TYPES, type TrackerDirection, type TrackerType } from '../../../api/contract/entities';
import type { ProjectDetail, TrackerRow, UserCard } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction } from '../../../app/runtime';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { TextArea, TextField } from '../../../components/Fields';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Sheet } from '../../../components/Sheet';
import { StatusSign } from '../../../components/StatusSign';
import { Switch } from '../../../components/Switch';
import { formatDay, stampDay } from '../../../lib/dates';
import { actorContext } from '../../../lib/grammar';
import { isOpen } from '../../../lib/tracker';
import { FileChips } from '../../files/Attachments';
import { DirectionMark, TypeIcon } from './marks';

function Person({ user }: { user: UserCard }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-2">
      <Avatar user={user} size={24} />
      <bdi className="text-subheadline">{user.name}</bdi>
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
    const waiting = untouched ? entry.waiting : wait ? (direction === 'in' ? 'us' : 'client') : null;
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
          onChange={setType}
        />
        <SegmentedControl
          label={t('tracker.directionLabel')}
          value={direction}
          options={[{ value: 'in', label: t('tracker.direction.in') }, { value: 'out', label: t('tracker.direction.out') }]}
          onChange={setDirection}
        />
      </div>
      <TextField id="tracker-edit-date" type="date" label={t('tracker.date')} value={date} onChange={(event) => setDate(event.target.value)} />
      <Switch id="tracker-edit-wait" label={t(direction === 'in' ? 'tracker.needsReply' : 'tracker.waitingToggle')} checked={wait} onChange={setWait} />
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
            <bdi>{user.name}</bdi>
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

/** One entry in full: the note, the people, the files, who logged it and when, with close, edit and delete. */
export function EntrySheet({ row, detail, onClose }: { row: TrackerRow; detail: ProjectDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [editing, setEditing] = useState(false);
  const close = useUndoable('tracker.close', { message: () => t('tracker.closedToast') });
  const remove = useUndoable('tracker.delete', { message: () => t('tracker.deleted'), onSuccess: onClose });
  const { entry } = row;
  const open = isOpen(entry);
  const action = t(entry.waiting === 'us' ? 'tracker.answered' : 'tracker.received');
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
            <span className="inline-flex items-center gap-1.5"><DirectionMark direction={entry.direction} />{t(`tracker.direction.${entry.direction}`)}</span>
            <span className="tabular">{formatDay(entry.date, lang, 'long')}</span>
          </p>
          {open && <p className="pt-3"><StatusSign state="active">{t(entry.waiting === 'us' ? 'tracker.waitingUs' : 'tracker.waitingClient')}</StatusSign></p>}
          {!open && entry.waiting !== null && row.closedBy && entry.closedAt && (
            <p className="flex flex-wrap items-center gap-2 pt-3">
              <StatusSign state="completed">{action}</StatusSign>
              <span className="text-footnote text-ink-2">
                {t('tracker.closedBy', { name: row.closedBy.name, date: formatDay(stampDay(entry.closedAt), lang), context: actorContext(row.closedBy) })}
              </span>
            </p>
          )}
          {entry.note && <Block title={t('tracker.note')}><p dir="auto" className="whitespace-pre-wrap text-body">{entry.note}</p></Block>}
          {row.people.length > 0 && <Block title={t('tracker.people')}><ul className="flex flex-wrap gap-x-4">{row.people.map((user) => <li key={user.id}><Person user={user} /></li>)}</ul></Block>}
          {row.files.length > 0 && <Block title={t('tracker.files')}><FileChips files={row.files} /></Block>}
          <div className="flex flex-col gap-1 pt-5 text-footnote text-ink-2">
            <p>
              {t('tracker.loggedBy', { name: row.createdBy.name, date: formatDay(stampDay(entry.createdAt), lang), context: actorContext(row.createdBy) })}
              {row.createdBy.kind === 'agent' && <> <AgentLabel /></>}
            </p>
            {entry.auto && <p>{t(entry.auto === 'upload' ? 'tracker.autoUpload' : entry.auto === 'version' ? 'tracker.autoVersion' : 'tracker.autoDelivered')}</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}
