import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { holdsAdminRights } from '../../../api/permissions';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { REMOTE } from '../../../app/mode';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useCan } from '../../../app/useRight';
import { actorContext } from '../../../lib/grammar';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';
import { AddButton, AdminPanel } from './AdminPanel';
import { useDeactivate } from './DeactivateSheet';
import { PersonFormSheet } from './PersonFormSheet';
import { useRemove } from './RemoveSheet';
import { roleLabel } from './roleSheetLogic';

export function PeopleSection() {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const users = useCall('users.list', { includeInactive: true });
  const session = useCall('session.get', {});
  const teams = useCall('teams.list', {});
  // The custom roles of the office: a Member with one shows the name of that role (owner, 2026-10-18, fbk_014).
  const settings = useCall('settings.get', {});
  const lang = useLang();
  const roleOf = (user: User) => roleLabel(settings.data?.roles, user.roleId, user.systemRole, lang, t);
  // Who still waits for their invitation (plan 5.1). The prototype has no sign-in, so it never asks.
  const invites = useCall('users.invites', {}, { enabled: REMOTE });
  const invited = new Set((invites.data ?? []).filter((row) => row.state === 'invited').map((row) => row.userId));
  const toast = useToast();
  const resend = useAction('users.resendInvite');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  // A person with live work gets a warning first (owner, 2026-10-03, API-7).
  const deactivate = useDeactivate();
  // A person deactivated by mistake can come back with their account and history (audit 2026-10-03, SHL-7).
  const reactivate = useUndoable('users.reactivate', { message: (user) => t('admin.reactivated', { name: nameOf(user) }) });
  // A turned-off person who will not come back leaves the list for good (owner, 2026-10-12).
  const remove = useRemove();
  const me = session.data?.authority.id;
  const people = { users: Object.fromEntries((users.data ?? []).map((user) => [user.id, user])) };
  // Management cannot change an Admin, so an Admin's row has no actions for it.
  const viewerIsAdmin = session.data?.authority.systemRole === 'admin';
  // Role rights version 2: each button asks the switch of its own power. The section opens for any of the five.
  const may = useCan();
  // An agent acts with the rights of its person, so the agent of an Admin holds Admin rights too. The screen asks the API rule
  // itself (audit 2026-10-03, SHL-9).
  return (
    <AdminPanel
      id="admin-people"
      title={t('admin.people')}
      action={may('people.invite') ? <AddButton label={t('admin.addPerson')} onClick={() => setAdding(true)} /> : null}
    >
      <LoadFailed query={users} />
      <ul className="flex flex-col">
        {[...(users.data ?? [])].sort(byName).map((user) => {
          // The office teams of this person, shown quietly after the discipline.
          const inTeams = (teams.data ?? []).filter((team) => team.members.some((member) => member.id === user.id)).map((team) => team.name);
          return (
          <li key={user.id} className="flex items-center gap-3 py-2">
            <Avatar user={user} size={36} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <bdi className="font-semibold">{nameOf(user)}</bdi>
                {user.kind === 'agent' && <AgentLabel />}
                {!user.active && <span className="rounded-full bg-fill px-2 text-caption text-label-2">{t('admin.inactive')}</span>}
                {user.active && invited.has(user.id) && <span className="rounded-full bg-fill px-2 text-caption text-label-2">{t('people.invited', { context: actorContext(user) })}</span>}
              </p>
              <p className="truncate text-footnote text-label-2">
                <span dir="ltr">{user.email}</span> · {roleOf(user)} · <bdi>{user.discipline}</bdi>
                {inTeams.length > 0 && <> · <bdi>{inTeams.join(', ')}</bdi></>}
              </p>
            </div>
            {(viewerIsAdmin || !holdsAdminRights(people, user)) && <Menu
              label={t('admin.actions', { name: nameOf(user) })}
              items={[
                { label: t('admin.edit'), onSelect: () => setEditing(user), hidden: !may('people.change') },
                {
                  label: t('people.resend'),
                  onSelect: () => resend.mutate({ id: user.id }, { onSuccess: () => toast.show({ message: t('people.onItsWay', { name: nameOf(user) }) }) }),
                  hidden: !user.active || !invited.has(user.id) || !may('people.invite'),
                },
                { label: t('admin.deactivate'), onSelect: () => deactivate.ask(user), hidden: !user.active || user.id === me || !may('people.turnOff'), destructive: true },
                // An agent comes back only while its person is active, as the API asks.
                { label: t('admin.reactivate'), onSelect: () => reactivate.mutate({ id: user.id }), hidden: user.active || (user.kind === 'agent' && !people.users[user.ownerId ?? '']?.active) || !may('people.turnOff') },
                { label: t('admin.remove'), onSelect: () => remove.ask(user), hidden: user.active || user.id === me || !may('people.remove'), destructive: true },
              ]}
            />}
          </li>
          );
        })}
      </ul>
      {deactivate.sheet}
      {remove.sheet}
      <PersonFormSheet open={adding} onOpenChange={setAdding} person={null} />
      <PersonFormSheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} person={editing} />
    </AdminPanel>
  );
}
