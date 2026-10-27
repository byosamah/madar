import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_HELPERS } from '../../../api/contract/limits';
import type { TaskRow, UserCard } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useCall } from '../../../app/runtime';
import { useIsPhone } from '../../../app/useIsPhone';
import { Avatar } from '../../../components/Avatar';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../../components/icons/animated/check';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { Popover } from '../../../components/Popover';
import { Sheet } from '../../../components/Sheet';
import { actorContext } from '../../../lib/grammar';
import { helpersOf } from '../../../lib/taskPeople';
import { useLeadChoices } from './useLeadChoices';

export type Mode = 'lead' | 'helper';

/**
 * The list that the pop-up (a desk) or the bottom sheet (a phone) shows. It is a part of its own: the sheet package must stay out of the first load,
 * and the task rows of Home are in it. One press on a name makes the change at once, with an Undo toast and no confirm button
 * (feedback fbk_006, 2026-10-11). The rules are the rules of the task panel: the leader and the Admin pick anyone active, and a
 * person outside the team joins it; the maker of a task who is not the leader picks only from the team.
 */
export default function PeopleList({ row, mode, anchor, onMode, onClose }: {
  row: TaskRow; mode: Mode; anchor: HTMLElement; onMode: (mode: Mode) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const projectId = row.project?.id;
  const everyone = useCall('users.list', {});
  const project = useCall('projects.get', { id: projectId ?? '' }, { enabled: Boolean(projectId) });
  const detail = project.data;
  const ready = Boolean(everyone.data) && (!projectId || Boolean(detail));
  const humans = (everyone.data ?? []).filter((person) => person.kind === 'human');
  // The list does not count the lead as on the team: a lead who left it reads as outside, as before.
  const { teamIds, pickable, changeLead } = useLeadChoices<UserCard>({ taskId: row.task.id, humans, detail, leadOnTeam: null });
  const helperIds = helpersOf(row.task);
  const lead = row.owner;
  const candidates = mode === 'lead'
    ? (lead && !pickable.some((person) => person.id === lead.id) ? [...pickable, lead] : pickable)
    : pickable.filter((person) => person.id !== row.task.ownerId && !helperIds.includes(person.id));
  // The lead comes first, so the focus on the first name rests on the person who leads now. Then the team, then the others.
  const rank = (person: UserCard) => (mode === 'lead' && person.id === row.task.ownerId ? 0 : teamIds.has(person.id) ? 1 : 2);
  const people = [...candidates].sort((a, b) => rank(a) - rank(b) || byName(a, b));
  const joins = useRef(false);
  const addHelper = useUndoable('tasks.update', {
    message: (output) => {
      const added = output.helpers[output.helpers.length - 1];
      return added ? t(joins.current ? 'taskPeople.helperAddedJoined' : 'taskPeople.helperAdded', { name: nameOf(added), context: actorContext(added) }) : '';
    },
  });
  const pick = (person: UserCard) => {
    if (mode === 'lead') {
      if (person.id !== row.task.ownerId) changeLead(person.id);
    } else {
      joins.current = !teamIds.has(person.id);
      addHelper.mutate({ id: row.task.id, patch: { helperIds: [...helperIds, person.id] } });
    }
    onClose();
  };
  const full = mode === 'helper' && helperIds.length >= MAX_HELPERS;
  const title = mode === 'lead' ? t('taskPeople.leadTitle') : t('taskPeople.helperTitle');
  const body = (
    <>
      {/* A sheet has its own title row, so the heading shows in the pop-up of a desk only. */}
      {!phone && <p className="shrink-0 text-headline text-ink">{title}</p>}
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
    </>
  );
  // A phone gets a bottom sheet with the same list (phone design D). A desk keeps the pop-up next to the picture.
  // key={mode}: a change of list starts the pop-up or the sheet again, so the focus goes to its first name.
  return phone
    ? <Sheet key={mode} open onOpenChange={(next) => { if (!next) onClose(); }} title={title}>{body}</Sheet>
    : <Popover key={mode} anchor={anchor} label={title} onClose={onClose} fit>{body}</Popover>;
}

