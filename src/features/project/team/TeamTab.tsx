import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { Menu, type MenuItem } from '../../../components/Menu';
import { formatNumber } from '../../../lib/dates';
import type { TabProps } from '../tabs';

type Member = ProjectDetail['members'][number];

function MemberRow({ member, detail }: { member: Member; detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const { user } = member;
  const [discipline, setDiscipline] = useState(member.discipline);
  useEffect(() => setDiscipline(member.discipline), [member.discipline]);
  const save = useAction('members.update', { onSuccess: () => toast.show({ message: t('team.disciplineSaved') }) });
  const lead = useAction('projects.setLeader', { onSuccess: () => toast.show({ message: t('project.leaderChanged') }) });
  const remove = useUndoable('members.remove', { message: () => t('team.removed', { name: user.name }) });
  const edit = detail.viewerCan.edit;
  const items: MenuItem[] = [
    { label: t('team.makeLeader'), onSelect: () => lead.mutate({ id: detail.project.id, leaderId: user.id }), hidden: !detail.viewerCan.changeLeader || member.isLeader },
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
        <p className="truncate font-semibold"><bdi>{user.name}</bdi></p>
        <p className="flex flex-wrap gap-x-3 text-footnote text-label-2">
          <span>{t('team.openTasks', { n: member.openTasks })}</span>
        </p>
      </div>
      {edit ? (
        <input
          aria-label={t('team.discipline', { name: user.name })}
          value={discipline}
          dir="auto"
          onChange={(event) => setDiscipline(event.target.value)}
          onBlur={() => {
            const value = discipline.trim();
            if (value && value !== member.discipline) save.mutate({ projectId: detail.project.id, userId: user.id, discipline: value });
          }}
          className="field w-40"
        />
      ) : <span className="text-subheadline text-label-2">{member.discipline}</span>}
      <div className="size-11 shrink-0">
        <Menu label={t('team.actions', { name: user.name })} items={items} />
      </div>
    </li>
  );
}

function AddMember({ detail }: TabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const onTeam = new Set(detail.members.map((member) => member.user.id));
  const candidates = (users.data ?? []).filter((user) => user.kind === 'human' && !onTeam.has(user.id));
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
                toast.show({ message: t('team.added', { name: person.name }) });
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
            {candidates.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </SelectField>
          <TextField id="add-discipline" label={t('team.newDiscipline')} value={discipline} dir="auto" onChange={(event) => setDiscipline(event.target.value)} />
          <Button type="submit" disabled={!userId || add.isPending}>{t('common.add')}</Button>
        </form>
      )}
    </section>
  );
}

/** The leader, then the members, with disciplines, open tasks and, for the leader and the Admin, hours this month (spec 5.8). */
export function TeamTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const leader = detail.members.find((member) => member.isLeader);
  const members = detail.members.filter((member) => !member.isLeader);
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="team-leader" className="surface rounded-card p-2">
        <h2 id="team-leader" className="px-2 pt-1 text-headline">{t('team.leader')}</h2>
        {leader ? <ul><MemberRow member={leader} detail={detail} /></ul> : <p className="px-2 pb-2 text-footnote text-label-2">{t('team.noLeader')}</p>}
      </section>
      <section aria-labelledby="team-members" className="surface rounded-card p-2">
        <h2 id="team-members" className="px-2 pt-1 text-headline">{t('team.members')}</h2>
        <ul>{members.map((member) => <MemberRow key={member.user.id} member={member} detail={detail} />)}</ul>
      </section>
      {detail.viewerCan.edit && <AddMember detail={detail} />}
    </div>
  );
}
