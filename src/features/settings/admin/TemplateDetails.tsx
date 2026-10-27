import { useEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_PREREQUISITES } from '../../../api/contract/limits';
import { Button } from '../../../components/Button';
import { SelectField, TextArea, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { XIcon } from '../../../components/icons/animated/x';
import { CheckRow } from './CheckRow';
import type { Kind, Picked } from './TemplateGantt';
import {
  moveStage, moveStageStart, moveTaskToStage, NAME_MAX, removeStage, removeTask, startsBeforeStageAbove, taskOutsideStage, tasksEndDay, touchTask, wholeNumber,
  type DraftProblem, type DraftStage, type DraftTask, type TemplateDraft,
} from './templateDraft';

/** A field that sends its value when the person leaves it or presses Enter, so a half-typed number moves nothing (INT-12). */
function CommitField({ value, onCommit, ...props }: { id: string; label: string; value: string; onCommit: (value: string) => void; error?: string; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <TextField
      {...props}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/** The same for a text area: the list of items is read when the person leaves the field. */
function CommitArea({ value, onCommit, ...props }: { id: string; label: string; value: string; onCommit: (value: string) => void; hint?: string } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'id'>) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <TextArea {...props} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => { if (text !== value) onCommit(text); }} />;
}

type Choice = { id: string; name: string };

/**
 * "Waits for": the parts of this template that must be done first. Until the part waits for something, only a small
 * "Waits for" button shows (ADM-06). The picker offers the other parts of the same kind and stops at the limit of the server. The
 * editor makes the link (it moves the part when it starts too early), and the server refuses a loop.
 */
function WaitsFor({ id, choices, chosen, onAdd, onRemove }: {
  id: string; choices: Choice[]; chosen: string[]; onAdd: (neededId: string) => void; onRemove: (neededId: string) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const named = choices.filter((choice) => chosen.includes(choice.id));
  const rest = choices.filter((choice) => !chosen.includes(choice.id));
  const canAdd = rest.length > 0 && chosen.length < MAX_PREREQUISITES;
  if (!canAdd && named.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {named.length > 0 && <span className="field-label">{t('projectTemplates.waitsFor')}</span>}
      {named.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {named.map((part) => (
            <li key={part.id} className="flex items-center gap-1 rounded-full bg-fill ps-3 pe-1">
              <bdi className="min-w-0 text-footnote">{part.name}</bdi>
              <IconButton label={t('projectTemplates.stopWaiting', { name: part.name })} onClick={() => onRemove(part.id)}>
                <AnimatedIcon icon={XIcon} size={14} aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {canAdd && !adding && (
        <Button variant="plain" className="self-start" onClick={() => setAdding(true)}>
          <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
          {t(named.length > 0 ? 'projectTemplates.waitsAnother' : 'projectTemplates.waitsFor')}
        </Button>
      )}
      {canAdd && adding && (
        <SelectField
          id={`${id}-waits`}
          label={t('projectTemplates.waitsFor')}
          autoFocus
          value=""
          onChange={(event) => {
            if (event.target.value) onAdd(event.target.value);
            setAdding(false);
          }}
          onBlur={() => setAdding(false)}
        >
          <option value="">{t('projectTemplates.chooseWait')}</option>
          {rest.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
        </SelectField>
      )}
    </div>
  );
}

const NUMBER = { inputMode: 'numeric' as const, autoComplete: 'off', className: 'tabular' };

/**
 * The details of the picked stage or task: the fields that the chart does not show (ADM-06). A stage start moves the tasks of the
 * stage with it, as the chart does (INT-12). The description, the checklist and "Needs review" of a task sit under a fold
 * (ADM-21). The editor puts this beside the chart, and in a sheet on a phone.
 */
export function TemplateDetails({ draft, setDraft, picked, onLink, onUnlink, onPick, problem }: {
  draft: TemplateDraft;
  setDraft: (draft: TemplateDraft) => void;
  picked: Picked;
  onLink: (kind: Kind, waitingId: string, neededId: string) => void;
  onUnlink: (kind: Kind, waitingId: string, neededId: string) => void;
  /** The part to show after this one is gone, or after a new task is added. */
  onPick: (part: Picked | null) => void;
  problem: DraftProblem | null;
}) {
  const { t } = useTranslation();
  const stage = picked.kind === 'stage' ? draft.stages.find((part) => part.id === picked.id) : undefined;
  const task = picked.kind === 'task' ? draft.tasks.find((part) => part.id === picked.id) : undefined;
  const error = (field: NonNullable<DraftProblem['field']>): string | undefined => (
    problem && problem.part && problem.part.kind === picked.kind && problem.part.id === picked.id && problem.field === field ? t(problem.key, problem.vars) : undefined
  );
  if (stage) return <StageDetails stage={stage} draft={draft} setDraft={setDraft} onLink={onLink} onUnlink={onUnlink} onPick={onPick} error={error} />;
  if (task) return <TaskDetails task={task} draft={draft} setDraft={setDraft} onLink={onLink} onUnlink={onUnlink} onPick={onPick} error={error} />;
  return null;
}

type DetailProps<T> = {
  draft: TemplateDraft; setDraft: (draft: TemplateDraft) => void;
  onLink: (kind: Kind, waitingId: string, neededId: string) => void;
  onUnlink: (kind: Kind, waitingId: string, neededId: string) => void;
  onPick: (part: Picked | null) => void;
  error: (field: NonNullable<DraftProblem['field']>) => string | undefined;
} & T;

function StageDetails({ stage, draft, setDraft, onLink, onUnlink, onPick, error }: DetailProps<{ stage: DraftStage }>) {
  const { t } = useTranslation();
  const index = draft.stages.findIndex((part) => part.id === stage.id);
  const tasks = draft.tasks.filter((task) => task.stageId === stage.id);
  const tasksEnd = tasksEndDay(draft, stage.id);
  const setStage = (next: DraftStage) => setDraft({ ...draft, stages: draft.stages.map((part) => (part.id === stage.id ? next : part)) });
  // A new own start moves the tasks of the stage by the same days, as the chart does. A stage with no own start yet takes the number.
  const commitStart = (value: string) => {
    const n = wholeNumber(value);
    if (n !== null && wholeNumber(stage.start) !== null) setDraft(moveStageStart(draft, stage.id, n));
    else setStage({ ...stage, start: value });
  };
  return (
    <div className="flex flex-col gap-4">
      <TextField
        id="tpl-detail-name"
        label={t('projectTemplates.stageName')}
        dir="auto"
        autoComplete="off"
        maxLength={NAME_MAX}
        value={stage.name}
        error={error('name')}
        onChange={(event) => setStage({ ...stage, name: event.target.value })}
      />
      <p className="text-footnote text-ink-2">{t('projectTemplates.stageDaysHint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <CommitField id="tpl-detail-start" label={t('projectTemplates.startDay')} value={stage.start} error={error('start')} onCommit={commitStart} {...NUMBER} />
        <TextField
          id="tpl-detail-days"
          label={t('projectTemplates.days')}
          value={stage.days}
          error={error('days')}
          onChange={(event) => setStage({ ...stage, days: event.target.value })}
          {...NUMBER}
        />
      </div>
      {tasks.length > 0 && wholeNumber(stage.start) !== null && <p className="text-footnote text-ink-2">{t('projectTemplates.stageStartNote')}</p>}
      {tasksEnd !== null && <p className="text-footnote text-ink-2">{t('projectTemplates.tasksEnd', { day: tasksEnd })}</p>}
      {startsBeforeStageAbove(draft, index) && <p className="text-footnote text-ink-2">{t('projectTemplates.startsBeforeAbove')}</p>}
      <WaitsFor
        id="tpl-detail"
        choices={draft.stages.flatMap((other, at) => (other.id === stage.id ? [] : [{ id: other.id, name: other.name.trim() || String(at + 1) }]))}
        chosen={stage.prerequisiteIds ?? []}
        onAdd={(neededId) => onLink('stage', stage.id, neededId)}
        onRemove={(neededId) => onUnlink('stage', stage.id, neededId)}
      />
      <div className="flex flex-wrap gap-2 border-t border-separator pt-3">
        {index > 0 && <Button variant="plain" onClick={() => setDraft(moveStage(draft, stage.id, -1))}>{t('projectTemplates.moveUp')}</Button>}
        {index < draft.stages.length - 1 && <Button variant="plain" onClick={() => setDraft(moveStage(draft, stage.id, 1))}>{t('projectTemplates.moveDown')}</Button>}
        <Button
          variant="destructive"
          onClick={() => {
            setDraft(removeStage(draft, stage.id));
            onPick(null);
          }}
        >
          {t('projectTemplates.removeStage')}
        </Button>
      </div>
    </div>
  );
}

function TaskDetails({ task, draft, setDraft, onLink, onUnlink, onPick, error }: DetailProps<{ task: DraftTask }>) {
  const { t } = useTranslation();
  const setTask = (next: DraftTask) => setDraft({ ...draft, tasks: draft.tasks.map((part) => (part.id === task.id ? next : part)) });
  // A start or a length that the person types is a choice of the person: the task is no longer fresh, so a move to another stage keeps it.
  const setDays = (next: DraftTask) => setTask(touchTask(next));
  return (
    <div className="flex flex-col gap-4">
      <TextField
        id="tpl-detail-title"
        label={t('projectTemplates.taskTitle')}
        dir="auto"
        autoComplete="off"
        maxLength={200}
        value={task.title}
        error={error('title')}
        onChange={(event) => setTask({ ...task, title: event.target.value })}
      />
      {/* The stage of the task (fbk_031). A move keeps the days of the task; a task that was just added goes where Add task would put it. */}
      <SelectField
        id="tpl-detail-stage"
        label={t('projectTemplates.taskStage')}
        value={task.stageId}
        hint={taskOutsideStage(draft, task.id) ? t('projectTemplates.taskOutside') : undefined}
        onChange={(event) => setDraft(moveTaskToStage(draft, task.id, event.target.value))}
      >
        {draft.stages.map((stage, index) => <option key={stage.id} value={stage.id}>{stage.name.trim() || String(index + 1)}</option>)}
      </SelectField>
      <SelectField id="tpl-detail-role" label={t('projectTemplates.role')} value={task.roleId} onChange={(event) => setTask({ ...task, roleId: event.target.value })}>
        <option value="">{t('lead.noLead')}</option>
        {draft.roles.map((role, index) => <option key={role.id} value={role.id}>{role.name || String(index + 1)}</option>)}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField id="tpl-detail-start" label={t('projectTemplates.startDay')} value={task.start} error={error('start')} onChange={(event) => setDays({ ...task, start: event.target.value })} {...NUMBER} />
        <TextField id="tpl-detail-days" label={t('projectTemplates.days')} value={task.days} error={error('days')} onChange={(event) => setDays({ ...task, days: event.target.value })} {...NUMBER} />
      </div>
      <CheckRow id="tpl-detail-flexible" checked={task.flexible} onChange={(flexible) => setTask({ ...task, flexible })}>
        <span className="text-subheadline">{t('projectTemplates.canStretch')}</span>
      </CheckRow>
      <WaitsFor
        id="tpl-detail"
        choices={draft.tasks.flatMap((other, at) => (other.id === task.id ? [] : [{ id: other.id, name: other.title.trim() || String(at + 1) }]))}
        chosen={task.prerequisiteIds ?? []}
        onAdd={(neededId) => onLink('task', task.id, neededId)}
        onRemove={(neededId) => onUnlink('task', task.id, neededId)}
      />
      <details className="rounded-xl border border-separator px-3 py-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-subheadline font-medium">{t('projectTemplates.moreAboutTask')}</summary>
        <div className="flex flex-col gap-4 pb-3 pt-2">
          <TextArea
            id="tpl-detail-description"
            label={t('projectTemplates.description')}
            dir="auto"
            autoComplete="off"
            maxLength={5000}
            value={task.description}
            onChange={(event) => setTask({ ...task, description: event.target.value })}
          />
          <CommitArea
            id="tpl-detail-checklist"
            label={t('projectTemplates.checklist')}
            hint={t('projectTemplates.checklistHint')}
            dir="auto"
            autoComplete="off"
            value={task.checklist.join('\n')}
            onCommit={(text) => setTask({ ...task, checklist: text.split('\n').map((line) => line.trim().slice(0, 200)).filter(Boolean).slice(0, 100) })}
          />
          <CheckRow id="tpl-detail-review" checked={task.needsReview} onChange={(needsReview) => setTask({ ...task, needsReview })}>
            <span className="text-subheadline">{t('projectTemplates.needsReview')}</span>
          </CheckRow>
        </div>
      </details>
      <div className="border-t border-separator pt-3">
        <Button
          variant="destructive"
          onClick={() => {
            setDraft(removeTask(draft, task.id));
            onPick(null);
          }}
        >
          {t('projectTemplates.removeThisTask')}
        </Button>
      </div>
    </div>
  );
}
