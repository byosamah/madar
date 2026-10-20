import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError } from '../../api/errors';
import type { MeetingDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Menu } from '../../components/Menu';
import { ProjectTile } from '../../components/ProjectTile';
import { Sheet } from '../../components/Sheet';
import { clockFormat, formatDay, now, stampDay } from '../../lib/dates';
import { trackerEntryLink } from '../../lib/params';
import { phaseOf } from '../../lib/meetings';
import { MeetingForm } from './MeetingForm';
import { joinLink, mainAction } from './meetingLinks';
import { AddMinutes, MinutesBody, QUIET } from './MinutesPart';
import { MinutesSheet } from './MinutesSheet';

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
 * is on), "Open in Google Maps" (a site visit of a project with a pin), else none. The menu holds Edit and Cancel, by `viewerCan`.
 */
export function MeetingSheet({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const query = useCall('meetings.get', { id: meetingId });
  const meeting = query.data;
  const projectId = meeting?.project?.id ?? '';
  // The pin of the project, for the Maps button of a site visit. The read is the one the project page makes.
  const project = useCall('projects.get', { id: projectId }, { enabled: meeting?.kind === 'site_visit' && projectId !== '' });
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [writing, setWriting] = useState(false);
  const cancel = useUndoable('meetings.cancel', { message: () => t('meetings.sheet.cancelled') });
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
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => { if (!open) onClose(); }}
        title={meeting.title}
        description={stateWord ? `${kind} · ${stateWord}` : kind}
        headerAction={(
          <Menu
            label={t('meetings.sheet.menu')}
            items={[
              { label: t('meetings.sheet.edit'), onSelect: () => setEditing(true), hidden: !meeting.viewerCan.edit },
              { label: t('meetings.sheet.cancel'), onSelect: () => setAsking(true), destructive: true, hidden: !meeting.viewerCan.cancel },
            ]}
          />
        )}
        footer={action && (
          <a href={action.href} target="_blank" rel="noopener noreferrer" className={MAIN_LINK}>
            {action.kind === 'join' ? t('meetings.sheet.join') : t('map.pin.open')}
          </a>
        )}
      >
        <dl className="flex flex-col gap-4 pt-1">
          <Fact label={t('meetings.sheet.when')}>
            <span className="block">{formatDay(day, lang, 'withWeekday')}</span>
            <span className="tabular block">{t('meetings.range', { from: clock.format(new Date(meeting.startsAt)), to: clock.format(new Date(meeting.endsAt)) })}</span>
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
                <ProjectTile id={meeting.project.id} mark={meeting.project.mark} size={24} />
                <bdi>{meeting.project.name}</bdi>
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
          {meeting.kind === 'team' && (
            <Link to="/dashboard/meeting" className="flex min-h-11 items-center self-start text-subheadline font-semibold text-link">{t('meetings.sheet.teamView')}</Link>
          )}
        </dl>
      </Sheet>
      <MeetingForm open={editing} onOpenChange={setEditing} meeting={meeting} />
      {writing && <MinutesSheet meeting={{ id: meeting.id, title: meeting.title, projectId: meeting.project?.id ?? null }} minutes={meeting.minutes ?? null} onClose={() => setWriting(false)} />}
      {asking && (
        <CancelSheet
          onKeep={() => setAsking(false)}
          onConfirm={() => {
            cancel.mutate({ id: meeting.id });
            setAsking(false);
          }}
        />
      )}
    </>
  );
}
