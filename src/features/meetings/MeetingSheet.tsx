import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError } from '../../api/errors';
import type { MeetingDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { useRight } from '../../app/useRight';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { ProjectTile } from '../../components/ProjectTile';
import { Sheet } from '../../components/Sheet';
import { clockFormat, formatDay, now, stampDay } from '../../lib/dates';
import { trackerEntryLink } from '../../lib/params';
import { phaseOf } from '../../lib/meetings';
import { MeetingForm } from './MeetingForm';
import { joinLink, mainAction } from './meetingLinks';
import { AddMinutes, MinutesBody, QUIET } from './MinutesPart';
import { MinutesSheet } from './MinutesSheet';
import { ScopeSheet, type Scope } from './ScopeSheet';
import { shownName } from '../../lib/projectLabel';

const MAIN_LINK = 'pressable signature inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-subheadline font-semibold shadow-[0_4px_14px_rgba(31,42,85,0.22)] transition-[box-shadow,filter,transform] duration-150 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(31,42,85,0.28)] hover:brightness-110';

/** One fact of the sheet: a small label, then its value. A hidden label is for a screen reader only. */
function Fact({ label, hidden = false, children }: { label: string; hidden?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={hidden ? 'sr-only' : 'text-footnote text-ink-2'}>{label}</dt>
      <dd className="text-subheadline text-ink">{children}</dd>
    </div>
  );
}

function PersonLine({ person }: { person: MeetingDetail['organizer'] }) {
  const nameOf = usePersonName();
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar user={person} size={24} />
      <bdi className="truncate">{nameOf(person)}</bdi>
    </span>
  );
}

/** The question before a cancel (owner, 2026-10-19): Keep meeting has the focus, and the cancel sits at the start side, away from the pointer. */
function CancelSheet({ onKeep, onConfirm }: { onKeep: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onKeep(); }}
      title={t('meetings.sheet.cancelTitle')}
      footer={(
        <>
          <Button variant="destructive" className="me-auto" onClick={onConfirm}>{t('meetings.sheet.cancelConfirm')}</Button>
          <Button autoFocus data-autofocus onClick={onKeep}>{t('meetings.sheet.keep')}</Button>
        </>
      )}
    >
      <p className="pt-1 text-body text-ink">{t('meetings.sheet.cancelBody')}</p>
    </Sheet>
  );
}

/** The sheet around a meeting that a person cannot read, or that did not load. A meeting of other people reads as gone. */
function Unavailable({ error, onRetry, onClose }: { error: unknown; onRetry: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const gone = error instanceof ApiError && (error.code === 'not_found' || error.code === 'forbidden');
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={t('meetings.kind.meeting')}>
      <p className="pt-1 text-body text-ink">{gone ? t('meetings.sheet.gone') : errorMessage(error, t)}</p>
      {!gone && <Button className="mt-3" onClick={onRetry}>{t('common.retry')}</Button>}
    </Sheet>
  );
}

/**
 * The sheet of one meeting (fbk_022, owner 2026-10-19). The title, the kind and its state, the day and time, the place, the project,
 * the people, the minutes and the notes. After the end one quiet "Add the minutes" shows until someone writes them (wave 2). At most one main button: "Join" (the place is a link and the start is near, or the meeting
 * is on), "Open in Google Maps" (a site visit of a project with a pin), else none. The footer holds, in this order, "Cancel meeting" (at the
 * start side) or "Delete meeting" (a cancelled meeting), "Edit", and the main button; each shows by `viewerCan` (owner, 2026-10-23, fbk_037).
 */
export function MeetingSheet({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const query = useCall('meetings.get', { id: meetingId });
  const meeting = query.data;
  // The team view is a screen of the Dashboard: no link without dashboard.view.
  const seesDashboard = useRight('dashboard.view');
  const projectId = meeting?.project?.id ?? '';
  // The pin of the project, for the Maps button of a site visit. The read is the one the project page makes.
  const project = useCall('projects.get', { id: projectId }, { enabled: meeting?.kind === 'site_visit' && projectId !== '' });
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [writing, setWriting] = useState(false);
  const scopeOf = useRef<Scope>('one');
  const cancel = useUndoable('meetings.cancel', { message: () => t(scopeOf.current === 'later' ? 'series.toast.cancelled' : 'meetings.sheet.cancelled') });
  // The sheet closes at once after a delete: the meeting is gone, so a read of it would only say so.
  const del = useUndoable('meetings.delete', {
    message: (output) => t(output.deleted > 1 ? 'series.toast.deleted' : 'meetings.sheet.deleted'),
    onSuccess: () => onClose(),
  });
  const remove = (id: string, scope: Scope) => del.mutate({ id, scope });
  if (!meeting) {
    return query.error ? <Unavailable error={query.error} onRetry={() => void query.refetch()} onClose={onClose} /> : null;
  }
  const phase = phaseOf(meeting, now());
  const action = mainAction(meeting, now(), project.data?.geo ?? null);
  const day = stampDay(meeting.startsAt);
  const clock = clockFormat(lang);
  const place = joinLink(meeting.where);
  const kind = t(`meetings.kind.${meeting.kind}`);
  const stateWord = phase === 'now' || phase === 'cancelled' || phase === 'done' ? t(`meetings.state.${phase}`) : '';
  // One quiet line under the time for a meeting of a series (wave 3): "Repeats every week", with the last day when the rule has one.
  const repeatLine = meeting.repeat
    ? meeting.repeat.until
      ? t(`series.lineUntil.${meeting.repeat.every}`, { day: formatDay(meeting.repeat.until, lang, 'short') })
      : t(`series.line.${meeting.repeat.every}`)
    : '';
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => { if (!open) onClose(); }}
        title={meeting.title}
        description={stateWord ? `${kind} · ${stateWord}` : kind}
        footer={(
          <>
            {meeting.viewerCan.cancel && <Button variant="destructive" className="me-auto" onClick={() => setAsking(true)}>{t('meetings.sheet.cancel')}</Button>}
            {meeting.viewerCan.delete && <Button variant="destructive" className="me-auto" onClick={() => (meeting.seriesId ? setDeleting(true) : remove(meeting.id, 'one'))}>{t('meetings.sheet.delete')}</Button>}
            {meeting.viewerCan.edit && <Button onClick={() => setEditing(true)}>{t('meetings.sheet.edit')}</Button>}
            {action && (
              <a href={action.href} target="_blank" rel="noopener noreferrer" className={MAIN_LINK}>
                {action.kind === 'join' ? t('meetings.sheet.join') : t('map.pin.open')}
              </a>
            )}
          </>
        )}
      >
        <dl className="flex flex-col gap-4 pt-1">
          <Fact label={t('meetings.sheet.when')}>
            <span className="block">{formatDay(day, lang, 'withWeekday')}</span>
            <span className="tabular block">{t('meetings.range', { from: clock.format(new Date(meeting.startsAt)), to: clock.format(new Date(meeting.endsAt)) })}</span>
            {repeatLine && <span className="block text-footnote text-ink-2">{repeatLine}</span>}
          </Fact>
          {meeting.where && (
            <Fact label={t('meetings.sheet.where')}>
              {place
                ? <a href={place} target="_blank" rel="noopener noreferrer" dir="ltr" className="block break-all text-link underline underline-offset-2">{place}</a>
                : <span dir="auto" className="block whitespace-pre-wrap break-words">{meeting.where}</span>}
            </Fact>
          )}
          <Fact label={t('meetings.sheet.project')}>
            {meeting.project ? (
              <Link to={`/projects/${meeting.project.id}`} className="-my-1.5 inline-flex min-h-11 items-center gap-2 text-link">
                <ProjectTile id={meeting.project.id} mark={meeting.project.mark} shape={meeting.project.shape} size={24} />
                <bdi>{shownName(meeting.project, lang)}</bdi>
              </Link>
            ) : (
              <>
                <span className="block">{t('office.word')}</span>
                <span className="block text-footnote text-ink-2">{t('meetings.sheet.officeNote')}</span>
              </>
            )}
          </Fact>
          <Fact label={t('meetings.sheet.organizer')}><PersonLine person={meeting.organizer} /></Fact>
          {meeting.attendees.length > 0 && (
            <Fact label={t('meetings.sheet.people')}>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {meeting.attendees.map((person) => <li key={person.id}><PersonLine person={person} /></li>)}
              </ul>
            </Fact>
          )}
          {meeting.minutes ? (
            <Fact label={t('minutes.title')}>
              <MinutesBody minutes={meeting.minutes} canEdit={meeting.viewerCan.minutes ?? false} onEdit={() => setWriting(true)}>
                {meeting.minutesPlace === 'tracker' && meeting.trackerEntry && meeting.project && (
                  <Link to={trackerEntryLink(meeting.project.id, meeting.trackerEntry.id)} className={QUIET}>
                    {t('minutes.openTracker')}
                  </Link>
                )}
              </MinutesBody>
            </Fact>
          ) : meeting.viewerCan.minutes && (
            <Fact label={t('minutes.title')} hidden><AddMinutes onClick={() => setWriting(true)} /></Fact>
          )}
          {meeting.guests && <Fact label={t('meetings.sheet.guests')}><span dir="auto" className="block whitespace-pre-wrap break-words">{meeting.guests}</span></Fact>}
          {meeting.notes && <Fact label={t('meetings.sheet.notes')}><span dir="auto" className="block whitespace-pre-wrap break-words">{meeting.notes}</span></Fact>}
          {meeting.kind === 'team' && seesDashboard && (
            <Link to="/dashboard/meeting" className="flex min-h-11 items-center self-start text-subheadline font-semibold text-link">{t('meetings.sheet.teamView')}</Link>
          )}
        </dl>
      </Sheet>
      <MeetingForm open={editing} onOpenChange={setEditing} meeting={meeting} />
      {writing && <MinutesSheet meeting={{ id: meeting.id, title: meeting.title, projectId: meeting.project?.id ?? null }} minutes={meeting.minutes ?? null} onClose={() => setWriting(false)} />}
      {asking && !meeting.seriesId && (
        <CancelSheet
          onKeep={() => setAsking(false)}
          onConfirm={() => {
            scopeOf.current = 'one';
            cancel.mutate({ id: meeting.id });
            setAsking(false);
          }}
        />
      )}
      {deleting && meeting.seriesId && (
        <ScopeSheet
          mode="delete"
          onClose={() => setDeleting(false)}
          onPick={(scope) => {
            setDeleting(false);
            remove(meeting.id, scope);
          }}
        />
      )}
      {/* A meeting of a series asks which meetings, in place of the plain question: "This meeting" or "This and later meetings". */}
      {asking && meeting.seriesId && (
        <ScopeSheet
          mode="cancel"
          onClose={() => setAsking(false)}
          onPick={(scope) => {
            scopeOf.current = scope;
            cancel.mutate({ id: meeting.id, scope });
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
