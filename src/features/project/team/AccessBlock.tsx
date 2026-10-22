import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUndoable } from '../../../app/actions';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useCall } from '../../../app/runtime';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { SelectField } from '../../../components/Fields';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { XIcon } from '../../../components/icons/animated/x';
import { IconButton } from '../../../components/IconButton';
import { isHiddenProject } from '../../../lib/projectLabel';
import type { TabProps } from '../tabs';

/**
 * "Who sees this project" (hidden projects, owner 2026-10-22), at the top of the Team tab. Two radio choices: everyone in the office, or
 * only the team and chosen people. With the second, the chosen people and one picker to add more. Each change saves at once with a toast
 * and Undo. A person who may not change it (viewerCan.access) sees one plain line.
 */
export function AccessBlock({ detail }: TabProps) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const users = useCall('users.list', {});
  const { project } = detail;
  const hidden = isHiddenProject(project);
  const chosenIds = project.access?.viewerIds ?? [];
  // The words of the toast follow the change that the person just made.
  const said = useRef<() => string>(() => '');
  const save = useUndoable('projects.setAccess', { message: () => said.current() });
  const [pick, setPick] = useState('');
  if (!detail.viewerCan.access) {
    return <p className="px-1 text-subheadline text-ink-2">{t(hidden ? 'projectAccess.lineTeam' : 'projectAccess.lineOpen')}</p>;
  }
  const everyone = users.data ?? [];
  const chosen = chosenIds.flatMap((id) => everyone.find((user) => user.id === id) ?? []).sort(byName);
  const taken = new Set([...chosenIds, ...detail.members.map((member) => member.user.id)]);
  const candidates = everyone.filter((user) => user.kind === 'human' && user.active !== false && !taken.has(user.id)).sort(byName);
  const change = (next: { hidden: boolean; viewerIds: string[] }, message: () => string) => {
    said.current = message;
    save.mutate({ id: project.id, ...next });
  };
  return (
    <section role="group" aria-labelledby="team-access" className="surface flex flex-col gap-3 rounded-card p-4">
      <h2 id="team-access" className="text-headline">{t('projectAccess.title')}</h2>
      <div className="flex flex-col">
        {([false, true] as const).map((closed) => (
          <label key={String(closed)} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
            <input
              type="radio"
              name="project-access"
              className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
              checked={hidden === closed}
              disabled={save.isPending}
              onChange={() => change({ hidden: closed, viewerIds: chosenIds }, () => t(closed ? 'projectAccess.savedTeam' : 'projectAccess.savedOpen'))}
            />
            <span className="text-subheadline text-ink">{t(closed ? 'projectAccess.team' : 'projectAccess.open')}</span>
          </label>
        ))}
      </div>
      {hidden && (
        <div className="flex flex-col gap-2">
          <h3 id="team-access-chosen" className="text-footnote font-semibold text-ink-2">{t('projectAccess.chosen')}</h3>
          {chosen.length === 0 ? <p className="text-footnote text-ink-2">{t('projectAccess.none')}</p> : (
            <ul aria-labelledby="team-access-chosen">
              {chosen.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-2">
                  <Avatar user={user} size={28} />
                  <bdi className="min-w-0 flex-1 truncate text-subheadline">{nameOf(user)}</bdi>
                  <IconButton
                    label={t('projectAccess.remove', { name: nameOf(user) })}
                    disabled={save.isPending}
                    onClick={() => change(
                      { hidden, viewerIds: chosenIds.filter((id) => id !== user.id) },
                      () => t('projectAccess.personRemoved', { name: nameOf(user) }),
                    )}
                  >
                    <AnimatedIcon icon={XIcon} size={16} aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 && (
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const person = candidates.find((user) => user.id === pick);
                if (!person) return;
                setPick('');
                change({ hidden, viewerIds: [...chosenIds, person.id] }, () => t('projectAccess.personAdded', { name: nameOf(person) }));
              }}
            >
              <SelectField id="access-add" label={t('projectAccess.add')} value={pick} onChange={(event) => setPick(event.target.value)}>
                <option value="" disabled>{t('team.person')}</option>
                {candidates.map((user) => <option key={user.id} value={user.id}>{nameOf(user)}</option>)}
              </SelectField>
              <Button type="submit" disabled={!pick || save.isPending}>{t('common.add')}</Button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
