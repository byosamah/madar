import { Circle, CircleCheck, Flag, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ChecklistItem, Task, TaskStatus } from '../../../api/contract/entities';
import type { ProjectDetail, TaskDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { DateDraftField, SelectField, TextArea, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { RichText } from '../../../components/RichText';
import { Sheet } from '../../../components/Sheet';
import { Switch } from '../../../components/Switch';
import { BOARD_COLUMNS } from '../../../lib/board';
import { formatDay, formatNumber } from '../../../lib/dates';
import { historyText } from './history';

type Patch = Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'stageId' | 'ownerId' | 'flagged' | 'needsReview' | 'checklist'>>;

/** A label and a value as plain text, for a field the viewer cannot change (spec 2.3: no dead controls). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-footnote text-label-2">{label}</span>
      <span className="min-h-11 py-2 text-body">{children}</span>
    </div>
  );
}

function Checklist({ task, edit, onChange }: { task: Task; edit: boolean; onChange: (items: ChecklistItem[]) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  // A local copy, so two quick ticks build on each other before the saved list comes back.
  const [items, setItems] = useState(task.checklist);
  const saved = JSON.stringify(task.checklist);
  useEffect(() => {
    setItems(JSON.parse(saved) as ChecklistItem[]);
  }, [saved]);
  const change = (next: ChecklistItem[]) => {
    setItems(next);
    onChange(next);
  };
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-headline">{t('taskSheet.checklist')}</h3>
      <ul>
        {!edit && items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-3">
            {item.done ? <CircleCheck size={20} className="shrink-0 text-accent" aria-hidden /> : <Circle size={20} className="shrink-0 text-label-3" aria-hidden />}
            <span dir="auto" className={`min-w-0 flex-1 ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
            {item.done && <span className="sr-only">{t('common.done')}</span>}
          </li>
        ))}
        {edit && items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              aria-label={item.text}
              className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
              checked={item.done}
              onChange={(event) => change(items.map((i) => (i.id === item.id ? { ...i, done: event.target.checked } : i)))}
            />
            <span dir="auto" className={`min-w-0 flex-1 ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
            {(
              <IconButton label={t('taskSheet.removeItem', { text: item.text })} onClick={() => change(items.filter((i) => i.id !== item.id))}>
                <X size={16} aria-hidden />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (!value) return;
            const id = `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            change([...items, { id, text: value, done: false }]);
            setText('');
          }}
        >
          <input
            aria-label={t('taskSheet.addItem')}
            placeholder={t('taskSheet.addItem')}
            value={text}
            dir="auto"
            onChange={(event) => setText(event.target.value)}
            className="min-h-11 w-full rounded-control bg-fill px-3 text-body text-label placeholder:text-label-2"
          />
        </form>
      )}
    </section>
  );
}

function History({ data, canUndoAgent }: { data: TaskDetail; canUndoAgent: (actingForId: string) => boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const undo = useAction('events.undo', { onSuccess: () => toast.show({ message: t('taskSheet.undone') }) });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-headline">{t('taskSheet.history')}</h3>
      {data.history.length === 0 ? <p className="text-footnote text-label-2">{t('taskSheet.noHistory')}</p> : (
        <ol className="flex flex-col gap-2">
          {data.history.map(({ event, actor }) => (
            <li key={event.id} className="flex items-center gap-2 text-footnote">
              <Avatar user={actor} size={24} />
              <p className="min-w-0 flex-1">
                <bdi className="font-semibold">{actor.name}</bdi>{' '}
                {actor.kind === 'agent' && <><AgentLabel />{' '}</>}
                <span className="text-label-2">{historyText(event, t, lang)}</span>
              </p>
              <span className="shrink-0 text-caption text-label-2"><Age stamp={event.createdAt} /></span>
              {event.actorKind === 'agent' && !event.undoneBy && event.verb !== 'undo' && canUndoAgent(event.actingForId) && (
                <Button variant="plain" onClick={() => undo.mutate({ eventId: event.id })}>{t('taskSheet.undoAgent')}</Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TaskBody({ detail, data, onClose }: { detail: ProjectDetail; data: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const toast = useToast();
  const session = useCall('session.get', {});
  const files = useCall('files.list', { projectId: detail.project.id, taskId: data.task.id });
  const { task, viewerCan } = data;
  const update = useAction('tasks.update');
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
  });
  const approve = useAction('tasks.approve', { onSuccess: () => toast.show({ message: t('taskSheet.approved') }) });
  const sendBack = useAction('tasks.sendBack', {
    onSuccess: () => {
      setNote('');
      toast.show({ message: t('taskSheet.sentBack') });
    },
  });
  const remove = useUndoable('tasks.delete', { message: () => t('taskSheet.deleted'), onSuccess: onClose });
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [note, setNote] = useState('');
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.title, task.description]);

  const patch = (changes: Patch) => update.mutate({ id: task.id, patch: changes });
  const edit = viewerCan.edit;
  const people = detail.members.map((member) => member.user);
  if (!people.some((person) => person.id === data.owner.id)) people.push(data.owner);
  const me = session.data?.authority.id;
  const canUndoAgent = (actingForId: string) => detail.viewerCan.review || actingForId === me;

  return (
    <div className="flex flex-col gap-5 pt-1">
      {!edit && <p className="rounded-2xl bg-fill p-3 text-footnote text-label-2">{t('taskSheet.readOnly')}</p>}
      {edit ? (
        <TextField
          id="task-title"
          label={t('taskSheet.title')}
          value={title}
          dir="auto"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title.trim() && title.trim() !== task.title) patch({ title: title.trim() });
          }}
        />
      ) : <Fact label={t('taskSheet.title')}><bdi>{task.title}</bdi></Fact>}
      <div className="grid gap-4 sm:grid-cols-2">
        {data.canMove ? (
          <SelectField id="task-status" label={t('taskSheet.status')} value={task.status} onChange={(event) => move.mutate({ id: task.id, status: event.target.value as TaskStatus })}>
            {BOARD_COLUMNS.map((status) => <option key={status} value={status}>{t(`taskStatus.${status}`)}</option>)}
          </SelectField>
        ) : <Fact label={t('taskSheet.status')}>{t(`taskStatus.${task.status}`)}</Fact>}
        {viewerCan.editAll ? (
          <SelectField id="task-owner" label={t('taskSheet.owner')} value={task.ownerId} onChange={(event) => patch({ ownerId: event.target.value })}>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </SelectField>
        ) : <Fact label={t('taskSheet.owner')}><bdi>{data.owner.name}</bdi></Fact>}
        {edit
          ? <DateDraftField id="task-due" label={t('taskSheet.dueDate')} value={task.dueDate ?? ''} onCommit={(dueDate) => patch({ dueDate })} />
          : <Fact label={t('taskSheet.dueDate')}>{task.dueDate ? formatDay(task.dueDate, lang, 'long') : t('overview.none')}</Fact>}
        {edit ? (
          <SelectField id="task-stage" label={t('taskSheet.stage')} value={task.stageId} onChange={(event) => patch({ stageId: event.target.value })}>
            {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </SelectField>
        ) : <Fact label={t('taskSheet.stage')}><bdi>{data.stage.name}</bdi></Fact>}
      </div>
      {edit
        ? <Switch id="task-flag" label={t('taskSheet.flag')} description={t('taskSheet.flagHint')} checked={task.flagged} onChange={(on) => patch({ flagged: on })} />
        : task.flagged && <p className="inline-flex items-center gap-2 text-subheadline text-orange-text"><Flag size={14} aria-hidden />{t('tasks.flagged')}</p>}
      {viewerCan.editAll && (
        <Switch id="task-review" label={t('taskSheet.needsReview')} description={t('taskSheet.needsReviewHint')} checked={task.needsReview} onChange={(on) => patch({ needsReview: on })} />
      )}
      {viewerCan.review && (
        <section aria-label={t('taskSheet.review')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
          <Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate({ id: task.id })}>{t('taskSheet.approve')}</Button>
          <TextArea id="task-note" label={t('taskSheet.sendBackNote')} value={note} dir="auto" onChange={(event) => setNote(event.target.value)} />
          <Button disabled={!note.trim() || sendBack.isPending} onClick={() => sendBack.mutate({ id: task.id, note: note.trim() })}>{t('taskSheet.sendBack')}</Button>
        </section>
      )}
      {edit ? (
        <TextArea
          id="task-description"
          label={t('taskSheet.description')}
          value={description}
          dir="auto"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== task.description) patch({ description });
          }}
        />
      ) : task.description && <Fact label={t('taskSheet.description')}><RichText body={task.description} /></Fact>}
      <Checklist task={task} edit={edit} onChange={(checklist) => patch({ checklist })} />
      <section className="flex flex-col gap-1">
        <h3 className="text-headline">{t('taskSheet.files')}</h3>
        {(files.data ?? []).length === 0
          ? <p className="text-footnote text-label-2">{t('taskSheet.noFiles')}</p>
          : <ul>{(files.data ?? []).map((view) => <li key={view.file.id} className="text-subheadline"><bdi>{view.file.name}</bdi></li>)}</ul>}
      </section>
      <section className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-headline">{t('taskSheet.hours')}</h3>
          <p className="tabular text-subheadline text-label-2">{t('taskSheet.hoursValue', { n: formatNumber(data.hours, lang, 1) })}</p>
        </div>
        {detail.viewerCan.logTime && <Button onClick={() => navigate('/work')}>{t('taskSheet.logTime')}</Button>}
      </section>
      <p className="text-footnote text-label-2">{t('taskSheet.comments', { n: data.commentCount })}</p>
      <History data={data} canUndoAgent={canUndoAgent} />
      {viewerCan.delete && (
        <Button variant="destructive" className="self-start" disabled={remove.isPending} onClick={() => remove.mutate({ id: task.id })}>{t('taskSheet.delete')}</Button>
      )}
    </div>
  );
}

/** The task panel: a side panel with no dim layer on desktop, a sheet on a phone (spec 5.4). */
export function TaskSheet({ taskId, detail, onClose }: { taskId: string; detail: ProjectDetail; onClose: () => void }) {
  const task = useCall('tasks.get', { id: taskId });
  useEffect(() => {
    if (task.error) onClose();
  }, [task.error, onClose]);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={task.data?.task.title ?? ''}
      blocking={false}
    >
      {task.data && <TaskBody detail={detail} data={task.data} onClose={onClose} />}
    </Sheet>
  );
}
