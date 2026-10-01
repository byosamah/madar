import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { fieldError } from '../../../app/errors';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Avatar } from '../../../components/Avatar';
import { AvatarStack } from '../../../components/AvatarStack';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';
import { Sheet } from '../../../components/Sheet';
import { counted } from '../../../lib/grammar';

/** Make or change one team: its name, and who is in it. A team holds people only. */
function TeamSheet({ team, open, onOpenChange }: { team: TeamRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const done = (message: string) => {
    toast.show({ message });
    onOpenChange(false);
  };
  const create = useAction('teams.create', { onSuccess: (made) => done(t('teams.created', { name: made.name })) });
  const update = useAction('teams.update', { onSuccess: () => done(t('teams.saved')) });
  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setName(team?.name ?? '');
    setMemberIds(team?.members.map((member) => member.id) ?? []);
    // The form starts fresh each time it opens; an old refusal must not stay under a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, team]);
  const people = (users.data ?? []).filter((user) => user.kind === 'human');
  const toggle = (id: string) => setMemberIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const error = team ? update.error : create.error;
  const submit = () => {
    if (team) update.mutate({ id: team.id, name: name.trim(), memberIds });
    else create.mutate({ name: name.trim(), memberIds });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={team ? t('teams.editTitle') : t('teams.add')}
      footer={<Button variant="primary" disabled={!name.trim() || create.isPending || update.isPending} onClick={submit}>{t('admin.save')}</Button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField id="team-name" label={t('teams.name')} value={name} dir="auto" maxLength={60} error={fieldError(error, 'name', t, t('admin.errors.name'))} onChange={(event) => setName(event.target.value)} />
        <fieldset className="flex flex-col">
          <legend className="field-label pb-1">{t('teams.members')}</legend>
          {people.map((user) => (
            <label key={user.id} className="flex min-h-11 items-center gap-3 text-body text-ink">
              <input type="checkbox" checked={memberIds.includes(user.id)} onChange={() => toggle(user.id)} className="size-5 accent-[var(--sig-from)]" />
              <Avatar user={user} size={28} />
              <span className="min-w-0 flex-1 truncate"><bdi>{user.name}</bdi></span>
              <span className="truncate text-footnote text-ink-2"><bdi>{user.discipline}</bdi></span>
            </label>
          ))}
        </fieldset>
      </div>
    </Sheet>
  );
}

/**
 * The office teams (colleague comment 15), such as Design, Technical, Interiors and Site. They are not the team of one project.
 * A person may be in several teams. Admin and Management make and change them.
 */
export function TeamsSection() {
  const { t } = useTranslation();
  const teams = useCall('teams.list', {});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const remove = useUndoable('teams.delete', { message: () => t('teams.deleted') });
  return (
    <section aria-labelledby="admin-teams" className="surface flex flex-col gap-3 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-teams" className="text-headline">{t('teams.title')}</h2>
        <Button onClick={() => setAdding(true)}>
          <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
          {t('teams.add')}
        </Button>
      </div>
      {teams.error && !teams.data && <LoadFailed error={teams.error} onRetry={() => void teams.refetch()} />}
      {teams.data?.length === 0 && <p className="text-footnote text-ink-2">{t('teams.empty')}</p>}
      <ul className="flex flex-col">
        {(teams.data ?? []).map((team) => (
          <li key={team.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold"><bdi>{team.name}</bdi></p>
              <p className="text-footnote text-ink-2">{counted(t, 'teams.count', team.members.length)}</p>
            </div>
            <AvatarStack leader={null} team={team.members} max={5} size={28} />
            <Menu
              label={t('teams.actions', { name: team.name })}
              items={[
                { label: t('teams.edit'), onSelect: () => setEditing(team) },
                { label: t('teams.delete'), onSelect: () => remove.mutate({ id: team.id }), destructive: true },
              ]}
            />
          </li>
        ))}
      </ul>
      <TeamSheet team={null} open={adding} onOpenChange={setAdding} />
      <TeamSheet team={editing} open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} />
    </section>
  );
}
