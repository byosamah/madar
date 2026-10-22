import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type MutableRefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChecklistItem, Task } from '../../../api/contract/entities';
import type { FileView, TaskDetail } from '../../../api/contract/views';
import { downloadFile } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useAction, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { AttachFileIcon } from '../../../components/icons/animated/attach-file';
import { CircleIcon } from '../../../components/icons/animated/circle';
import { CircleCheckIcon } from '../../../components/icons/animated/circle-check';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { canPreview, PreviewSheet } from '../files/PreviewSheet';
import type { DragChecklistProps } from './ChecklistDrag';
import { loadChecklistLayer, loadedChecklistLayer } from './checklistLayerLoader';
import { ChecklistRow, ItemGrip } from './ChecklistRow';
import { historyText } from './history';
import { markFocus, restoreFocus, type FocusMark } from './SortableTaskRows';

export type Patch = Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'startDate' | 'schedule' | 'durationDays' | 'ownerId' | 'helperIds' | 'prerequisiteIds' | 'flagged' | 'needsReview' | 'checklist'>> & { stageId?: string };

/** A label and a value as plain text, for a field the viewer cannot change (spec 2.3: no dead controls). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-footnote text-label-2">{label}</span>
      <span className="min-h-11 py-2 text-body">{children}</span>
    </div>
  );
}

/** What the person typed in "Add an item", with the list it goes into, so the panel can save it when it closes. */
export type ChecklistDraft = { text: string; items: ChecklistItem[] };
export const newItemId = () => `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * edit: add and remove items (task.details). tick: tick items (task.work). With edit and no tick the boxes show and stay off.
 * Otherwise the list is plain text (role rights version 2).
 */
export function Checklist({ task, edit, tick, onChange, draft }: { task: Task; edit: boolean; tick: boolean; onChange: (items: ChecklistItem[]) => void; draft: MutableRefObject<ChecklistDraft> }) {
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
  useEffect(() => {
    draft.current = { text, items };
  }, [draft, text, items]);
  const toggle = (id: string, done: boolean) => change(items.map((i) => (i.id === id ? { ...i, done } : i)));
  const remove = (id: string) => change(items.filter((i) => i.id !== id));
  // A person who edits the checklist puts the items in their own order with a grip at the end of each item (fbk_043). One drop saves the
  // whole list once. dnd-kit is a chunk of its own: the list first draws static rows, and the drag layer takes their place once loaded.
  const sortable = edit && items.length > 1;
  const [Layer, setLayer] = useState<ComponentType<DragChecklistProps> | null>(loadedChecklistLayer);
  const listRef = useRef<HTMLUListElement>(null);
  const mark = useRef<FocusMark | null>(null);
  useEffect(() => {
    if (!sortable || Layer) return undefined;
    let live = true;
    loadChecklistLayer().then((layer) => {
      if (!live) return;
      mark.current = markFocus(listRef.current);
      setLayer(() => layer);
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [sortable, Layer]);
  useLayoutEffect(() => {
    if (!Layer || !mark.current) return;
    const kept = mark.current;
    mark.current = null;
    restoreFocus(listRef.current, kept);
  }, [Layer]);
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-headline">{t('taskSheet.checklist')}</h3>
      {!edit && !tick && (
        <ul>
          {items.map((item) => (
            <li key={item.id} className="flex min-h-11 items-center gap-3">
              {item.done ? <AnimatedIcon icon={CircleCheckIcon} size={20} className="shrink-0 text-link" aria-hidden /> : <AnimatedIcon icon={CircleIcon} size={20} className="shrink-0 text-label-3" aria-hidden />}
              <span dir="auto" className={`min-w-0 flex-1 ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
              {item.done && <span className="sr-only">{t('common.done')}</span>}
            </li>
          ))}
        </ul>
      )}
      {(edit || tick) && (Layer && sortable ? (
        <Layer items={items} edit={edit} tick={tick} onToggle={toggle} onRemove={remove} onReorder={change} listRef={listRef} />
      ) : (
        <ul ref={listRef}>
          {items.map((item) => (
            <ChecklistRow key={item.id} item={item} edit={edit} tick={tick} onToggle={toggle} onRemove={remove} drag={sortable ? { lifted: false, grip: <ItemGrip text={item.text} /> } : undefined} />
          ))}
        </ul>
      ))}
      {edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (!value) return;
            change([...items, { id: newItemId(), text: value, done: false }]);
            setText('');
          }}
        >
          <input
            aria-label={t('taskSheet.addItem')}
            placeholder={t('taskSheet.addItem')}
            value={text}
            dir="auto"
            onChange={(event) => setText(event.target.value)}
            className="field"
          />
        </form>
      )}
    </section>
  );
}

/** One empty list for a task with no files yet, so the memo of TaskFiles holds while the list loads. */
export const EMPTY_FILES: FileView[] = Object.freeze([]) as unknown as FileView[];

/**
 * The files of the task, one press each: a picture or a PDF opens the preview, any other file saves (audit 2026-10-03, PRJ-24).
 * Memoized, as History, so a key in the title, the description or the note renders it again only when its files change
 * (performance audit 2026-10-07, RND-4).
 */
export const TaskFiles = memo(function TaskFiles({ views }: { views: FileView[] }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const [preview, setPreview] = useState<FileView | null>(null);
  const open = (view: FileView) => {
    if (canPreview(view.latest.mimeType)) setPreview(view);
    else downloadFile(api, view.file.id).catch((error: unknown) => toast.failed(error));
  };
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-headline">{t('taskSheet.files')}</h3>
      {views.length === 0 ? <p className="text-footnote text-label-2">{t('taskSheet.noFiles')}</p> : (
        <ul className="flex flex-wrap gap-2">
          {views.map((view) => (
            <li key={view.file.id}>
              <button
                type="button"
                aria-label={t('taskSheet.openFile', { name: view.file.name })}
                onClick={() => open(view)}
                className="pressable inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-fill px-3 text-footnote text-ink hover:bg-fill-strong"
              >
                <AnimatedIcon icon={AttachFileIcon} size={14} aria-hidden className="shrink-0" />
                <bdi className="truncate">{view.file.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && <PreviewSheet views={[preview]} index={0} onIndex={() => undefined} onClose={() => setPreview(null)} />}
    </section>
  );
});

/** Memoized (RND-4): it renders again when the task data or the Undo rule changes. Its ages refresh through AgeRefresh. */
export const History = memo(function History({ data, canUndoAgent }: { data: TaskDetail; canUndoAgent: (actingForId: string) => boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
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
                <bdi className="font-semibold">{nameOf(actor)}</bdi>{' '}
                {actor.kind === 'agent' && <><AgentLabel />{' '}</>}
                <span className="text-label-2">{historyText(event, t, lang, actor.gender)}</span>
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
});
