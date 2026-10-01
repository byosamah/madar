import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField } from '../../../components/Fields';
import { counted } from '../../../lib/grammar';

/**
 * Adds every person of an office team who is not on the project yet (colleague comment 15).
 * The rules are those of adding one person, so the server decides who may do it. The toast says how many came in.
 */
export function AddTeam({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const teams = useCall('teams.list', {});
  const [teamId, setTeamId] = useState('');
  const add = useAction('members.addTeam');
  const list = (teams.data ?? []).filter((team) => team.members.length > 0);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="team-add-team" className="surface rounded-card p-4">
      <h2 id="team-add-team" className="text-headline">{t('team.addTeam')}</h2>
      <p className="pt-1 text-footnote text-ink-2">{t('team.addTeamHint')}</p>
      <form
        className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const team = list.find((item) => item.id === teamId);
          if (!team) return;
          add.mutate({ projectId: detail.project.id, teamId }, {
            onSuccess: ({ added }) => {
              toast.show({ message: added > 0 ? counted(t, 'team.teamAdded', added) : t('team.teamNone', { name: team.name }) });
              setTeamId('');
            },
          });
        }}
      >
        <SelectField id="add-team" label={t('team.team')} value={teamId} onChange={(event) => setTeamId(event.target.value)}>
          <option value="" disabled>{t('team.team')}</option>
          {list.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </SelectField>
        <Button type="submit" disabled={!teamId || add.isPending}>{t('teams.add')}</Button>
      </form>
    </section>
  );
}
