import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { useUndoable } from '../../../app/actions';
import { useCall } from '../../../app/runtime';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';
import { PersonFormSheet } from './PersonFormSheet';

export function PeopleSection() {
  const { t } = useTranslation();
  const users = useCall('users.list', { includeInactive: true });
  const session = useCall('session.get', {});
  const teams = useCall('teams.list', {});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const deactivate = useUndoable('users.deactivate', { message: (user) => t('admin.deactivated', { name: user.name }) });
  // A person deactivated by mistake can come back with their account and history (audit 2026-10-03, SHL-7).
  const reactivate = useUndoable('users.reactivate', { message: (user) => t('admin.reactivated', { name: user.name }) });
  const me = session.data?.authority.id;
  const byId = new Map((users.data ?? []).map((user) => [user.id, user]));
  // Management cannot change an Admin, so an Admin's row has no actions for it.
  const viewerIsAdmin = session.data?.authority.systemRole === 'admin';
  // An agent acts with the rights of its person, so the agent of an Admin holds Admin rights too, as the API rule says (audit 2026-10-03, SHL-9).
  const holdsAdminRights = (user: User) => user.systemRole === 'admin' || (user.kind === 'agent' && byId.get(user.ownerId ?? '')?.systemRole === 'admin');
  return (
    <section aria-labelledby="admin-people" className="surface flex flex-col gap-3 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-people" className="text-headline">{t('admin.people')}</h2>
        <Button onClick={() => setAdding(true)}>
          <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
          {t('admin.addPerson')}
        </Button>
      </div>
      {users.error && !users.data && <LoadFailed error={users.error} onRetry={() => void users.refetch()} />}
      <ul className="flex flex-col">
        {(users.data ?? []).map((user) => {
          // The office teams of this person, shown quietly after the discipline.
          const inTeams = (teams.data ?? []).filter((team) => team.members.some((member) => member.id === user.id)).map((team) => team.name);
          return (
          <li key={user.id} className="flex items-center gap-3 py-2">
            <Avatar user={user} size={36} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <bdi className="font-semibold">{user.name}</bdi>
                {user.kind === 'agent' && <AgentLabel />}
                {!user.active && <span className="rounded-full bg-fill px-2 text-caption text-label-2">{t('admin.inactive')}</span>}
              </p>
              <p className="truncate text-footnote text-label-2">
                <span dir="ltr">{user.email}</span> · {t(`admin.roles.${user.systemRole}`)} · <bdi>{user.discipline}</bdi>
                {inTeams.length > 0 && <> · <bdi>{inTeams.join(', ')}</bdi></>}
              </p>
            </div>
            {(viewerIsAdmin || !holdsAdminRights(user)) && <Menu
              label={t('admin.actions', { name: user.name })}
              items={[
                { label: t('admin.edit'), onSelect: () => setEditing(user) },
                { label: t('admin.deactivate'), onSelect: () => deactivate.mutate({ id: user.id }), hidden: !user.active || user.id === me, destructive: true },
                // An agent comes back only while its person is active, as the API asks.
                { label: t('admin.reactivate'), onSelect: () => reactivate.mutate({ id: user.id }), hidden: user.active || (user.kind === 'agent' && !byId.get(user.ownerId ?? '')?.active) },
              ]}
            />}
          </li>
          );
        })}
      </ul>
      <PersonFormSheet open={adding} onOpenChange={setAdding} person={null} />
      <PersonFormSheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} person={editing} />
    </section>
  );
}
