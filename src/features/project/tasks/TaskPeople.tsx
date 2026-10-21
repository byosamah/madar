import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_HELPERS } from '../../../api/contract/limits';
import type { TaskRow, UserCard } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useCall } from '../../../app/runtime';
import { Avatar } from '../../../components/Avatar';
import { AvatarStack } from '../../../components/AvatarStack';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../../components/icons/animated/check';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { NoLeadMark } from '../../../components/NoLeadMark';
import { Popover } from '../../../components/Popover';
import { actorContext } from '../../../lib/grammar';
import { helpersOf } from '../../../lib/taskPeople';

type Mode = 'lead' | 'helper';

/** The picture of the task people: the lead alone, the lead with the helpers, or the dashed mark of a task with no lead. */
function Picture({ row }: { row: TaskRow }) {
  if (!row.owner) return <NoLeadMark size={26} />;
  return row.helpers.length > 0
    ? <AvatarStack leader={row.owner} team={row.helpers} max={3} size={20} leaderSize={28} />
    : <Avatar user={row.owner} size={26} />;
}

/**
 * The list that the pop-up shows. One press on a name makes the change at once, with an Undo toast and no confirm button
 * (feedback fbk_006, 2026-10-11). The rules are the rules of the task panel: the leader and the Admin pick anyone active, and a
 * person outside the team joins it; the maker of a task who is not the leader picks only from the team.
 */
function PeopleList({ row, mode, anchor, onMode, onClose }: {
  row: TaskRow; mode: Mode; anchor: HTMLElement; onMode: (mode: Mode) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const projectId = row.project?.id;
  const everyone = useCall('users.list', {});
  const project = useCall('projects.get', { id: projectId ?? '' }, { enabled: Boolean(projectId) });
  const detail = project.data;
  const ready = Boolean(everyone.data) && (!projectId || Boolean(detail));
  const humans = (everyone.data ?? []).filter((person) => person.kind === 'human');
  // An office task has no team, so nobody joins one.
  const teamIds = detail ? new Set([...detail.members.map((member) => member.user.id), ...(detail.leader ? [detail.leader.id] : [])]) : new Set(humans.map((person) => person.id));
  const pickable: UserCard[] = detail && !detail.viewerCan.editTeam ? humans.filter((person) => teamIds.has(person.id)) : humans;
  const helperIds = helpersOf(row.task);
  const lead = row.owner;
  const candidates = mode === 'lead'
    ? (lead && !pickable.some((person) => person.id === lead.id) ? [...pickable, lead] : pickable)
    : pickable.filter((person) => person.id !== row.task.ownerId && !helperIds.includes(person.id));
  // The lead comes first, so the focus on the first name rests on the person who leads now. Then the team, then the others.
  const rank = (person: UserCard) => (mode === 'lead' && person.id === row.task.ownerId ? 0 : teamIds.has(person.id) ? 1 : 2);
  const people = [...candidates].sort((a, b) => rank(a) - rank(b) || byName(a, b));
  const joins = useRef(false);
  const newLead = useUndoable('tasks.update', {
    message: (output) => (output.owner
      ? t(joins.current ? 'taskSheet.newLeadJoined' : 'taskSheet.newLead', { name: nameOf(output.owner), context: actorContext(output.owner) })
      : t('lead.removed')),
  });
  const addHelper = useUndoable('tasks.update', {
    message: (output) => {
      const added = output.helpers[output.helpers.length - 1];
      return added ? t(joins.current ? 'taskPeople.helperAddedJoined' : 'taskPeople.helperAdded', { name: nameOf(added), context: actorContext(added) }) : '';
    },
  });
  const pick = (person: UserCard) => {
    joins.current = !teamIds.has(person.id);
    if (mode === 'lead') {
      if (person.id !== row.task.ownerId) newLead.mutate({ id: row.task.id, patch: { ownerId: person.id } });
    } else {
      addHelper.mutate({ id: row.task.id, patch: { helperIds: [...helperIds, person.id] } });
    }
    onClose();
  };
  const full = mode === 'helper' && helperIds.length >= MAX_HELPERS;
  const title = mode === 'lead' ? t('taskPeople.leadTitle') : t('taskPeople.helperTitle');
  return (
    // key={mode}: a change of list starts the pop-up again, so the focus goes to its first name.
    <Popover key={mode} anchor={anchor} label={title} onClose={onClose} fit>
      <p className="shrink-0 text-headline text-ink">{title}</p>
      {ready && (people.length === 0 || full
        ? <p className="text-footnote text-ink-2">{t('taskPeople.none')}</p>
        : (
          // The list scrolls inside the pop-up on a short screen, so the heading and the "Add a helper" row stay in view.
          <ul className="-mx-2 flex min-h-0 min-w-56 flex-1 flex-col overflow-y-auto">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  aria-current={mode === 'lead' && person.id === row.task.ownerId ? 'true' : undefined}
                  onClick={() => pick(person)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-start text-body hover:bg-fill focus:bg-fill focus:outline-none"
                >
                  <Avatar user={person} size={26} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <bdi className="truncate">{nameOf(person)}</bdi>
                    {!teamIds.has(person.id) && <span className="text-footnote text-ink-2">{t('taskPeople.joinsTeam', { context: actorContext(person) })}</span>}
                  </span>
                  {mode === 'lead' && person.id === row.task.ownerId && (
                    <>
                      <AnimatedIcon icon={CheckIcon} size={16} className="shrink-0 text-ink-2" aria-hidden />
                      <span className="sr-only">{t('taskPeople.currentLead')}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {mode === 'lead' && (
        // The way to the helper list when there is no hover to show the "+" (a phone).
        <button type="button" onClick={() => onMode('helper')} className="-mx-2 flex min-h-11 shrink-0 items-center gap-3 rounded-xl border-t border-hairline px-2 text-start text-body text-link hover:bg-fill focus:bg-fill focus:outline-none">
          <AnimatedIcon icon={PlusIcon} size={16} className="shrink-0" aria-hidden />
          {t('taskPeople.addHelper')}
        </button>
      )}
    </Popover>
  );
}

/**
 * The people at the end of a task row. A person who may change them (`canEditPeople`) presses the picture to change the lead, and a
 * small "+" beside it (it shows on hover or focus, never on a touch screen or under 640 px) opens the helpers to add. No full task panel opens
 * (feedback fbk_006, 2026-10-11). Any other person sees the picture only. The rows keep one width, so the pictures line up.
 */
export function TaskPeople({ row }: { row: TaskRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ mode: Mode; anchor: HTMLElement } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const setMode = useCallback((mode: Mode) => setOpen((current) => (current ? { ...current, mode } : current)), []);
  if (!row.canEditPeople) {
    return (
      <span className="flex items-center">
        <Picture row={row} />
        <span aria-hidden className="ms-1 size-6 shrink-0 max-sm:hidden pointer-coarse:hidden" />
      </span>
    );
  }
  return (
    <span className="group/people flex items-center">
      <button
        type="button"
        aria-label={t('taskPeople.open', { title: row.task.title })}
        aria-haspopup="dialog"
        aria-expanded={open?.mode === 'lead'}
        onClick={(event) => setOpen({ mode: 'lead', anchor: event.currentTarget })}
        className="pressable -m-1 flex items-center rounded-full p-1"
      >
        <Picture row={row} />
      </button>
      <button
        type="button"
        aria-label={t('taskPeople.addHelperTo', { title: row.task.title })}
        aria-haspopup="dialog"
        aria-expanded={open?.mode === 'helper'}
        onClick={(event) => setOpen({ mode: 'helper', anchor: event.currentTarget })}
        className="pressable ms-1 grid size-6 shrink-0 place-items-center rounded-full bg-fill text-ink-2 opacity-0 transition-opacity hover:bg-fill-strong hover:text-ink focus-visible:opacity-100 group-hover/people:opacity-100 max-sm:hidden pointer-coarse:hidden motion-reduce:transition-none"
      >
        <AnimatedIcon icon={PlusIcon} size={14} aria-hidden />
      </button>
      {open && <PeopleList row={row} mode={open.mode} anchor={open.anchor} onMode={setMode} onClose={close} />}
    </span>
  );
}
