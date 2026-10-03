import { useTranslation } from 'react-i18next';
import { MAX_HELPERS, type User } from '../../../api/contract/entities';
import type { UserCard } from '../../../api/contract/views';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { XIcon } from '../../../components/icons/animated/x';
import { Avatar } from '../../../components/Avatar';
import { SelectField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { actorContext } from '../../../lib/grammar';

/** A person as a choice. Someone outside the team joins it when picked, and the choice says so. The Arabic verb agrees with a woman (audit 2026-10-03, PRJ-11). */
export function personOption(person: Pick<User, 'id' | 'name' | 'gender'>, onTeam: boolean, t: ReturnType<typeof useTranslation>['t']): string {
  return onTeam ? person.name : t('taskSheet.joinsTeam', { name: person.name, context: actorContext(person) });
}

/**
 * The people who help the lead (colleague comment 9). They tick checklist items and comment; the lead finishes the task.
 * The leader and the Admin add and remove them, and may pick someone outside the team, who then joins it.
 * Everyone else sees the list as plain text.
 */
export function TaskHelpers({ helpers, leadId, people, teamIds, canEdit, onChange }: {
  helpers: UserCard[]; leadId: string; people: User[]; teamIds: Set<string>; canEdit: boolean; onChange: (helperIds: string[]) => void;
}) {
  const { t } = useTranslation();
  if (!canEdit && helpers.length === 0) return null;
  const ids = helpers.map((helper) => helper.id);
  const choices = people.filter((person) => person.id !== leadId && !ids.includes(person.id));
  return (
    <section aria-labelledby="task-helpers" className="flex flex-col gap-1">
      <h3 id="task-helpers" className="text-headline">{t('taskSheet.helpers')}</h3>
      {helpers.length === 0 && <p className="text-footnote text-label-2">{t('taskSheet.noHelpers')}</p>}
      <ul>
        {helpers.map((helper) => (
          <li key={helper.id} className="flex min-h-11 items-center gap-3">
            <Avatar user={helper} size={26} />
            <bdi className="min-w-0 flex-1 truncate">{helper.name}</bdi>
            {canEdit && (
              <IconButton label={t('taskSheet.removeHelper', { name: helper.name })} onClick={() => onChange(ids.filter((id) => id !== helper.id))}>
                <AnimatedIcon icon={XIcon} size={16} aria-hidden />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {canEdit && ids.length < MAX_HELPERS && choices.length > 0 && (
        <SelectField
          id="task-add-helper"
          label={t('taskSheet.addHelper')}
          hint={t('taskSheet.helpersHint')}
          value=""
          onChange={(event) => {
            if (event.target.value) onChange([...ids, event.target.value]);
          }}
        >
          <option value="">{t('taskSheet.pickHelper')}</option>
          {choices.map((person) => <option key={person.id} value={person.id}>{personOption(person, teamIds.has(person.id), t)}</option>)}
        </SelectField>
      )}
    </section>
  );
}
