import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { useUndoable } from '../../../app/actions';
import { useCall } from '../../../app/runtime';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { Menu } from '../../../components/Menu';
import { PersonFormSheet } from './PersonFormSheet';

export function PeopleSection() {
  const { t } = useTranslation();
  const users = useCall('users.list', { includeInactive: true });
  const session = useCall('session.get', {});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const deactivate = useUndoable('users.deactivate', { message: (user) => t('admin.deactivated', { name: user.name }) });
  const me = session.data?.authority.id;
  return (
    <section aria-labelledby="admin-people" className="surface flex flex-col gap-3 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-people" className="text-headline">{t('admin.people')}</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden />
          {t('admin.addPerson')}
        </Button>
      </div>
      <ul className="flex flex-col">
        {(users.data ?? []).map((user) => (
          <li key={user.id} className="flex items-center gap-3 py-2">
            <Avatar user={user} size={36} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <bdi className="font-semibold">{user.name}</bdi>
                {user.kind === 'agent' && <AgentLabel />}
                {!user.active && <span className="rounded-full bg-fill px-2 text-caption text-label-2">{t('admin.inactive')}</span>}
              </p>
              <p className="truncate text-footnote text-label-2">
                <span dir="ltr">{user.email}</span> · {t(`admin.roles.${user.systemRole}`)} · <bdi>{user.discipline}</bdi> · {t('dashboard.hoursValue', { n: user.weeklyHourTarget })}
              </p>
            </div>
            <Menu
              label={t('admin.actions', { name: user.name })}
              items={[
                { label: t('admin.edit'), onSelect: () => setEditing(user) },
                { label: t('admin.deactivate'), onSelect: () => deactivate.mutate({ id: user.id }), hidden: !user.active || user.id === me, destructive: true },
              ]}
            />
          </li>
        ))}
      </ul>
      <PersonFormSheet open={adding} onOpenChange={setAdding} person={null} />
      <PersonFormSheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} person={editing} />
    </section>
  );
}
