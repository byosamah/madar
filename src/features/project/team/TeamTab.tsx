import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { Menu, type MenuItem } from '../../../components/Menu';
import { LeaderSheet } from '../ProjectActions';
import type { TabProps } from '../tabs';
import { AccessBlock } from './AccessBlock';
import { AddTeam } from './AddTeam';

type Member = ProjectDetail['members'][number];

function MemberRow({ member, detail, onMakeLeader }: { member: Member; detail: ProjectDetail; onMakeLeader: () => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const toast = useToast();
  const { user } = member;
  const [discipline, setDiscipline] = useState(member.discipline);
  useEffect(() => setDiscipline(member.discipline), [member.discipline]);
  const save = useAction('members.update', { onSuccess: () => toast.show({ message: t('team.disciplineSaved') }) });
  const remove = useUndoable('members.remove', { message: () => t('team.removed', { name: nameOf(user) }) });
  const edit = detail.viewerCan.editTeam === true;
  const items: MenuItem[] = [
    // "Make leader" hands the project over and has no Undo, so it opens the leader sheet: a pick, then Save (audit 2026-10-03, PRJ-21).
    { label: t('team.makeLeader'), onSelect: onMakeLeader, hidden: !detail.viewerCan.changeLeader || member.isLeader },
    {
      label: t('team.remove'),
      onSelect: () => remove.mutate({ projectId: detail.project.id, userId: user.id }),
      hidden: !edit || member.isLeader || member.openTasks > 0,
      destructive: true,
    },
  ];
  return (
    <li className="flex flex-wrap items-center gap-3 px-2 py-2">
      <Avatar user={user} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold"><bdi>{nameOf(user)}</bdi></p>
        <p className="flex flex-wrap gap-x-3 text-footnote text-label-2">{t('team.openTasks', { n: member.openTasks })}</p>
      </div>
      {edit ? (
        <input
          aria-label={t('team.discipline', { name: nameOf(user) })}
          value={discipline}
          dir="auto"
          onChange={(event) => setDiscipline(event.target.value)}
          onBlur={() => {
            const value = discipline.trim();
            if (value && value !== member.discipline) save.mutate({ projectId: detail.project.id, userId: user.id, discipline: value });
          }}
          // On a phone the field takes its own line under the name, so the name keeps its width (owner, 2026-10-05).
          className="field order-last ms-12 w-[calc(100%-3rem)] sm:order-none sm:ms-0 sm:w-40"
        />
      ) : <span className="order-last ms-12 text-subheadline text-label-2 sm:order-none sm:ms-0">{member.discipline}</span>}
      <div className="size-11 shrink-0">
        <Menu label={t('team.actions', { name: nameOf(user) })} items={items} />
      </div>
    </li>
  );
}

function AddMember({ detail }: TabProps) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const toast = useToast();
  const users = useCall('users.list', {});
  const onTeam = new Set(detail.members.map((member) => member.user.id));
  const candidates = (users.data ?? []).filter((user) => user.kind === 'human' && !onTeam.has(user.id)).sort(byName);
  const [userId, setUserId] = useState('');
  const [discipline, setDiscipline] = useState('');
  const add = useAction('members.add');
  return (
    <section aria-labelledby="team-add" className="surface rounded-card p-4">
      <h2 id="team-add" className="text-headline">{t('team.add')}</h2>
      {candidates.length === 0 ? <p className="mt-2 text-footnote text-label-2">{t('team.noOne')}</p> : (
        <form
          className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const person = candidates.find((user) => user.id === userId);
            if (!person) return;
            add.mutate({ projectId: detail.project.id, userId, discipline: discipline.trim() || undefined }, {
              onSuccess: () => {
                toast.show({ message: t('team.added', { name: nameOf(person) }) });
                setUserId('');
                setDiscipline('');
              },
            });
          }}
        >
          <SelectField
            id="add-person"
            label={t('team.person')}
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setDiscipline(candidates.find((user) => user.id === event.target.value)?.discipline ?? '');
            }}
          >
            <option value="" disabled>{t('team.person')}</option>
            {candidates.map((user) => <option key={user.id} value={user.id}>{nameOf(user)}</option>)}
          </SelectField>
          <TextField id="add-discipline" label={t('team.newDiscipline')} value={discipline} dir="auto" onChange={(event) => setDiscipline(event.target.value)} />
          <Button type="submit" disabled={!userId || add.isPending}>{t('common.add')}</Button>
        </form>
      )}
    </section>
  );
}

/** The leader, then the members, with disciplines and open tasks (spec 5.8). */
export function TeamTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const leader = detail.members.find((member) => member.isLeader);
  const members = detail.members.filter((member) => !member.isLeader);
  const [newLeader, setNewLeader] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <AccessBlock detail={detail} />
      <section aria-labelledby="team-leader" className="surface rounded-card p-2">
        <h2 id="team-leader" className="px-2 pt-1 text-headline">{t('team.leader')}</h2>
        {leader ? <ul><MemberRow member={leader} detail={detail} onMakeLeader={() => setNewLeader(leader.user.id)} /></ul> : <p className="px-2 pb-2 text-footnote text-label-2">{t('team.noLeader')}</p>}
      </section>
      <section aria-labelledby="team-members" className="surface rounded-card p-2">
        <h2 id="team-members" className="px-2 pt-1 text-headline">{t('team.members')}</h2>
        <ul>{members.map((member) => <MemberRow key={member.user.id} member={member} detail={detail} onMakeLeader={() => setNewLeader(member.user.id)} />)}</ul>
      </section>
      {detail.viewerCan.editTeam && <AddMember detail={detail} />}
      {detail.viewerCan.editTeam && <AddTeam detail={detail} />}
      <LeaderSheet
        detail={detail}
        open={newLeader !== null}
        pick={newLeader ?? undefined}
        onOpenChange={(open) => {
          if (!open) setNewLeader(null);
        }}
      />
    </div>
  );
}
