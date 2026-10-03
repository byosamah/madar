import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrackerRow, UserCard } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../../components/icons/animated/check';
import { Sheet } from '../../../components/Sheet';
import { formatDay, todayISO } from '../../../lib/dates';
import { ageInDays } from '../../../lib/tracker';
import { addWorkingDays } from '../../../lib/workdays';
import { ReplyFields } from '../../project/tracker/ReplyFields';
import { ageText } from '../../project/tracker/marks';
import { activeMembers } from '../../../lib/tracker';

const HEADING = 'text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2';

/** The sheet that asks who replies and by which day. It is the same two fields as the Tracker tab. */
function AssignSheet({ row, members, onClose }: { row: TrackerRow; members: UserCard[]; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useCall('session.get', {}).data?.user.id;
  const [userId, setUserId] = useState('');
  const [dueDate, setDueDate] = useState(() => addWorkingDays(todayISO(), 2));
  const assign = useUndoable('tracker.assignReply', { message: () => t('tracker.replyAssigned'), onSuccess: onClose });
  const who = userId || (members.some((member) => member.id === me) ? me : members[0]?.id) || '';
  return (
    <Sheet
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={row.entry.title}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!who || !dueDate || assign.isPending} onClick={() => assign.mutate({ id: row.entry.id, userId: who, dueDate })}>{t('tracker.assign')}</Button>
        </>
      )}
    >
      <div className="pt-2">
        <ReplyFields id="meeting-assign" members={members} userId={who} dueDate={dueDate} onUser={setUserId} onDueDate={setDueDate} />
      </div>
    </Sheet>
  );
}

function Item({ row, canAct, onAssign }: { row: TrackerRow; canAct: boolean; onAssign: (id: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const close = useUndoable('tracker.close', { message: () => t(row.entry.waiting === 'us' ? 'tracker.answeredToast' : 'tracker.receivedToast') });
  const { entry, replyTask } = row;
  const action = t(entry.waiting === 'us' ? 'tracker.answered' : 'tracker.received');
  // A reply task that is done does not hold the item any more, so the item offers a new one (as the Tracker tab does).
  const replying = replyTask && replyTask.status !== 'done' ? replyTask : null;
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <bdi className="min-w-0 flex-1 text-[17px] font-semibold text-ink">{entry.title}</bdi>
        <span className="tabular shrink-0 text-[15px] text-ink-2">{ageText(t, ageInDays(entry.date, todayISO()))}</span>
      </div>
      {replying && (
        <p className="text-[15px] text-ink-2">
          {t('dashboard.meeting.replyLine', { name: replying.owner.name, date: replying.dueDate ? formatDay(replying.dueDate, lang) : '' })}
        </p>
      )}
      {canAct && (
        <div className="flex flex-wrap gap-2">
          {entry.waiting === 'us' && !replying && <Button onClick={() => onAssign(entry.id)}>{t('tracker.replyWho')}</Button>}
          <Button variant="secondary" aria-label={t('tracker.closeLabel', { action, title: entry.title })} disabled={close.isPending} onClick={() => close.mutate({ id: entry.id })}>
            <AnimatedIcon icon={CheckIcon} size={16} aria-hidden />
            {action}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * The open client items of one project, for the meeting (owner, 2026-10-02): what waits for our reply and what waits for the client.
 * The panel only shows things, so it is not there when nothing is open.
 */
export function ClientItemsPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const open = useCall('tracker.list', { projectId, openOnly: true });
  const detail = useCall('projects.get', { id: projectId });
  const [assigning, setAssigning] = useState<string | null>(null);
  const rows = open.data ?? [];
  if (rows.length === 0) return null;
  const oldestFirst = [...rows].sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.id.localeCompare(b.entry.id));
  const groups = (['us', 'client'] as const)
    .map((waiting) => ({ waiting, rows: oldestFirst.filter((row) => row.entry.waiting === waiting) }))
    .filter((group) => group.rows.length > 0);
  const canAct = detail.data?.viewerCan.post === true;
  const shown = rows.find((row) => row.entry.id === assigning);
  return (
    <section aria-label={t('dashboard.meeting.clientItems')} className="panel flex flex-col gap-2 p-5">
      <h3 className={HEADING}>{t('dashboard.meeting.clientItems')}</h3>
      {groups.map((group) => {
        const id = `meeting-client-${projectId}-${group.waiting}`;
        return (
          <div key={group.waiting} role="group" aria-labelledby={id}>
            <h4 id={id} className="pt-1 text-[15px] font-semibold text-ink-2">{t(group.waiting === 'us' ? 'tracker.waitingUs' : 'tracker.waitingClient')}</h4>
            <ul className="divide-y divide-hairline">
              {group.rows.map((row) => <Item key={row.entry.id} row={row} canAct={canAct} onAssign={setAssigning} />)}
            </ul>
          </div>
        );
      })}
      {shown && detail.data && <AssignSheet key={shown.entry.id} row={shown} members={activeMembers(detail.data.members)} onClose={() => setAssigning(null)} />}
    </section>
  );
}
