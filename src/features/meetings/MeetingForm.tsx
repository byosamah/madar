import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeetingKindName } from '../../api/contract/limits';
import { MEETING_KINDS, MEETING_LIMITS } from '../../api/contract/limits';
import type { MeetingDetail } from '../../api/contract/views';
import { ApiError } from '../../api/errors';
import { useUndoable } from '../../app/actions';
import { errorMessage } from '../../app/errors';
import { usePersonName, useByPersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { SelectField, TextArea, TextField } from '../../components/Fields';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { Sheet } from '../../components/Sheet';
import { addDays, now, todayISO } from '../../lib/dates';
import { kindDefaults, minutesBetween, phaseOf } from '../../lib/meetings';
import { isLive } from '../../lib/overview';
import { LENGTHS, defaultSlot, lengthWords, splitStamp, stampOf } from './formModel';
import { TimeField } from './TimeField';

const L = MEETING_LIMITS;

/** Everything the form holds. The three "set" marks say that the person chose the value, so a change of kind no longer replaces it. */
type Draft = {
  kind: MeetingKindName; title: string; projectId: string; day: string; time: string; durationMin: number; attendeeIds: string[]; where: string;
  /** undefined: follow the kind. '' is nobody. Else the person for the minutes. */
  minutes: string | undefined; guests: string; notes: string; more: boolean; lengthSet: boolean; whereSet: boolean;
};

function draftOf(meeting: MeetingDetail | undefined, projectId: string): Draft {
  if (meeting) {
    const { day, time } = splitStamp(meeting.startsAt);
    return {
      kind: meeting.kind, title: meeting.title, projectId: meeting.project?.id ?? '', day, time, durationMin: minutesBetween(meeting.startsAt, meeting.endsAt),
      attendeeIds: meeting.attendees.map((person) => person.id), where: meeting.where, minutes: meeting.minutesBy?.id ?? '', guests: meeting.guests,
      notes: meeting.notes, more: false, lengthSet: true, whereSet: true,
    };
  }
  const slot = defaultSlot(now());
  return {
    kind: 'meeting', title: '', projectId, day: slot.day, time: slot.time, durationMin: kindDefaults('meeting').durationMin, attendeeIds: [], where: '',
    minutes: undefined, guests: '', notes: '', more: false, lengthSet: false, whereSet: false,
  };
}

/** The tick list of the people. A person of the meeting who left stays on the list while ticked, so a save never drops a name by surprise. */
function PeoplePicker({ people, value, onChange, disabled }: { people: { id: string; name: string; nameAr?: string; avatarUrl: string | null; kind: 'human' | 'agent'; discipline: string; gender?: 'female' | 'male' }[]; value: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-1.5">
      <legend className="field-label pb-1.5">{t('meetings.form.people')}</legend>
      <div className="max-h-48 overflow-y-auto rounded-xl bg-fill/60 p-1">
        {people.map((person) => (
          <label key={person.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-fill">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
              checked={value.includes(person.id)}
              onChange={(event) => onChange(event.target.checked ? [...value, person.id] : value.filter((id) => id !== person.id))}
            />
            <Avatar user={person} size={28} />
            <bdi className="min-w-0 flex-1 truncate text-subheadline">{nameOf(person)}</bdi>
            <span className="text-footnote text-ink-2"><bdi>{person.discipline}</bdi></span>
          </label>
        ))}
      </div>
      <p className="text-caption text-ink-2">
        {t('meetings.form.peopleHint')}
        {value.length > 0 && <> {t('meetings.form.chosen', { n: value.length, count: value.length })}</>}
      </p>
    </fieldset>
  );
}

/**
 * The sheet that plans a meeting, and the same sheet that edits one (fbk_022, owner 2026-10-19). Eight controls: Kind, Title, Project,
 * Day, Time, Length, People, Where. The fold "More" holds Minutes by, Guests and Notes. One button. A kind sets the length and the
 * person for the minutes until the person chooses them; the place of a site visit starts with the address of the project pin.
 * The edit form has no Project: a meeting stays in its project. After the end only the notes change. A refusal of the server shows in
 * the form, in its own words.
 */
export function MeetingForm({ open, onOpenChange, meeting, project = null }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** The meeting to edit. Without it, the form plans a new meeting. */
  meeting?: MeetingDetail;
  /** The project that a new meeting starts in (the Meetings panel of a project). */
  project?: { id: string; name: string } | null;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const edit = meeting !== undefined;
  const session = useCall('session.get', {});
  const me = session.data?.authority.id ?? '';
  const admin = session.data?.user.systemRole === 'admin';
  const projects = useCall('projects.list', admin ? { filter: 'all', status: 'all', sort: 'name' } : { filter: 'mine', status: 'all', sort: 'name' }, { enabled: open && !edit });
  const users = useCall('users.list', {}, { enabled: open });
  const [draft, setDraft] = useState<Draft>(() => draftOf(meeting, project?.id ?? ''));
  const [problem, setProblem] = useState('');
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  // The form starts again each time it opens, from the meeting or from the defaults of a new one.
  useEffect(() => {
    if (!open) return;
    const next = draftOf(meeting, project?.id ?? '');
    setDraft(meeting && phaseOf(meeting, now()) === 'done' ? { ...next, more: true } : next);
    setProblem('');
    // The meeting object changes on every read; only an opening starts the form again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const organizerId = meeting ? meeting.organizer.id : me;
  const locked = meeting !== undefined && phaseOf(meeting, now()) === 'done';
  const live = useMemo(() => (projects.data ?? []).filter((summary) => isLive(summary.project.status)), [projects.data]);
  const locationOf = (id: string) => live.find((summary) => summary.project.id === id)?.project.location ?? '';

  // The people to tick: every active person except the organizer, and the people already on the meeting.
  const people = useMemo(() => {
    const listed = (users.data ?? []).filter((user) => user.kind === 'human' && user.active && user.id !== organizerId);
    const known = new Set(listed.map((user) => user.id));
    const extra = (meeting?.attendees ?? []).filter((person) => !known.has(person.id));
    return [...listed, ...extra].sort(byName);
  }, [users.data, meeting, organizerId, byName]);

  // The person for the minutes: the one chosen, if still on the meeting; else the default of the kind.
  const defaultMinutes = kindDefaults(draft.kind).minutesByOrganizer ? organizerId : '';
  const minutesChoices = [organizerId, ...draft.attendeeIds];
  const minutes = draft.minutes !== undefined && (draft.minutes === '' || minutesChoices.includes(draft.minutes)) ? draft.minutes : defaultMinutes;
  const minutesPeople = [...(meeting ? [meeting.organizer] : []), ...(session.data && !meeting ? [session.data.user] : []), ...people].filter((person) => minutesChoices.includes(person.id));

  const onKind = (kind: MeetingKindName) => {
    const defaults = kindDefaults(kind);
    set({
      kind,
      ...(draft.lengthSet ? {} : { durationMin: defaults.durationMin }),
      ...(draft.whereSet || edit ? {} : { where: kind === 'site_visit' ? locationOf(draft.projectId) : '' }),
    });
  };
  const onProject = (projectId: string) => set({ projectId, ...(draft.whereSet || draft.kind !== 'site_visit' ? {} : { where: locationOf(projectId) }) });

  const refused = (error: unknown): boolean => {
    if (!(error instanceof ApiError) || error.code === 'failed' || error.code === 'unauthenticated') return false;
    setProblem(errorMessage(error, t));
    return true;
  };
  const planned = useUndoable('meetings.create', { message: () => t('meetings.form.planned'), onSuccess: () => onOpenChange(false), onRefused: refused });
  const saved = useUndoable('meetings.update', { message: () => t('meetings.form.saved'), onSuccess: () => onOpenChange(false), onRefused: refused });

  const startsAt = stampOf(draft.day, draft.time);
  const sameAs = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const moved = meeting !== undefined && (
    Date.parse(startsAt) !== Date.parse(meeting.startsAt) || draft.durationMin !== minutesBetween(meeting.startsAt, meeting.endsAt) || draft.where.trim() !== meeting.where
  );
  const title = draft.title.trim();
  const ready = title !== '' && draft.day !== '' && !planned.isPending && !saved.isPending;

  const submit = () => {
    setProblem('');
    const text = { where: draft.where.trim(), guests: draft.guests.trim(), notes: draft.notes.trim() };
    if (!meeting) {
      planned.mutate({
        kind: draft.kind, title, projectId: draft.projectId || null, startsAt, durationMin: draft.durationMin, ...text,
        attendeeIds: draft.attendeeIds, minutesById: minutes || null,
      });
      return;
    }
    // Only what changed goes to the server, so a save that changes nothing writes nothing.
    const length = minutesBetween(meeting.startsAt, meeting.endsAt);
    const change = {
      ...(draft.kind !== meeting.kind ? { kind: draft.kind } : {}),
      ...(title !== meeting.title ? { title } : {}),
      ...(Date.parse(startsAt) !== Date.parse(meeting.startsAt) ? { startsAt } : {}),
      ...(draft.durationMin !== length ? { durationMin: draft.durationMin } : {}),
      ...(text.where !== meeting.where ? { where: text.where } : {}),
      ...(text.guests !== meeting.guests ? { guests: text.guests } : {}),
      ...(text.notes !== meeting.notes ? { notes: text.notes } : {}),
      ...(!sameAs(draft.attendeeIds, meeting.attendees.map((person) => person.id)) ? { attendeeIds: draft.attendeeIds } : {}),
      ...((minutes || null) !== (meeting.minutesBy?.id ?? null) ? { minutesById: minutes || null } : {}),
    };
    if (Object.keys(change).length === 0) onOpenChange(false);
    else saved.mutate({ id: meeting.id, ...change });
  };

  const today = todayISO();
  const projectName = meeting?.project?.name ?? '';
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(edit ? 'meetings.form.editTitle' : 'meetings.form.newTitle')}
      footer={<Button variant="primary" disabled={!ready} onClick={submit}>{t(edit ? 'meetings.form.save' : 'meetings.form.plan')}</Button>}
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) submit();
        }}
      >
        <SelectField id="meeting-kind" label={t('meetings.form.kind')} disabled={locked} value={draft.kind} onChange={(event) => onKind(event.target.value as MeetingKindName)}>
          {MEETING_KINDS.map((kind) => <option key={kind} value={kind}>{t(`meetings.kind.${kind}`)}</option>)}
        </SelectField>
        <TextField
          id="meeting-title" label={t('meetings.form.title')} required dir="auto" autoComplete="off" maxLength={L.titleMax} disabled={locked}
          value={draft.title} onChange={(event) => set({ title: event.target.value })}
        />
        {!edit && (
          <SelectField
            id="meeting-project" label={t('meetings.form.project')} value={draft.projectId}
            hint={draft.projectId === '' ? t('meetings.form.officeHint') : undefined} onChange={(event) => onProject(event.target.value)}
          >
            <option value="">{t('meetings.form.noProject')}</option>
            {project && !live.some((summary) => summary.project.id === project.id) && <option value={project.id}>{project.name}</option>}
            {live.map((summary) => <option key={summary.project.id} value={summary.project.id}>{summary.project.name}</option>)}
          </SelectField>
        )}
        {edit && projectName !== '' && <p className="-mt-2 text-footnote text-ink-2"><bdi>{projectName}</bdi></p>}
        <div className="grid grid-cols-3 gap-3">
          <DateField
            id="meeting-day" label={t('meetings.form.day')} required disabled={locked} value={draft.day} min={edit ? undefined : addDays(today, -L.pastDays)}
            onChange={(day) => set({ day })}
          />
          <TimeField id="meeting-time" label={t('meetings.form.time')} required disabled={locked} value={draft.time} onChange={(time) => set({ time })} />
          <SelectField
            id="meeting-length" label={t('meetings.form.length')} disabled={locked} value={String(draft.durationMin)}
            onChange={(event) => set({ durationMin: Number(event.target.value), lengthSet: true })}
          >
            {(LENGTHS.includes(draft.durationMin) ? LENGTHS : [...LENGTHS, draft.durationMin].sort((a, b) => a - b)).map((minutesLong) => {
              const words = lengthWords(minutesLong);
              return <option key={minutesLong} value={minutesLong}>{t(words.key, words.values)}</option>;
            })}
          </SelectField>
        </div>
        <PeoplePicker people={people} value={draft.attendeeIds} disabled={locked} onChange={(attendeeIds) => set({ attendeeIds })} />
        <TextField
          id="meeting-where" label={t('meetings.form.where')} dir="auto" autoComplete="off" maxLength={L.whereMax} disabled={locked}
          hint={t('meetings.form.whereHint')} value={draft.where} onChange={(event) => set({ where: event.target.value, whereSet: true })}
        />
        <div className="flex flex-col gap-4">
          <button
            type="button"
            aria-expanded={draft.more}
            aria-controls="meeting-more"
            onClick={() => set({ more: !draft.more })}
            className="pressable flex min-h-11 items-center gap-1 self-start rounded-full px-1 text-subheadline font-semibold text-link"
          >
            {t('meetings.form.more')}
            <AnimatedIcon icon={ChevronDownIcon} size={16} aria-hidden className={draft.more ? 'rotate-180' : ''} />
          </button>
          {draft.more && (
            <div id="meeting-more" className="flex flex-col gap-4">
              <SelectField id="meeting-minutes" label={t('meetings.form.minutesBy')} disabled={locked} value={minutes} onChange={(event) => set({ minutes: event.target.value })}>
                <option value="">{t('meetings.form.nobody')}</option>
                {minutesPeople.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
              </SelectField>
              <TextField
                id="meeting-guests" label={t('meetings.form.guests')} dir="auto" autoComplete="off" maxLength={L.guestsMax} disabled={locked}
                hint={t('meetings.form.guestsHint')} value={draft.guests} onChange={(event) => set({ guests: event.target.value })}
              />
              <TextArea
                id="meeting-notes" label={t('meetings.form.notes')} dir="auto" autoComplete="off" maxLength={L.notesMax}
                value={draft.notes} onChange={(event) => set({ notes: event.target.value })}
              />
            </div>
          )}
        </div>
        {locked && <p className="text-footnote text-ink-2">{t('errors.reasons.meeting_over')}</p>}
        {moved && meeting.attendees.length > 0 && <p className="text-footnote text-ink-2">{t('meetings.form.moved')}</p>}
        {problem && <p role="alert" className="text-footnote text-late">{problem}</p>}
      </form>
    </Sheet>
  );
}
