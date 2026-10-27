import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { MAX_HELPERS } from '../../../api/contract/limits';
import type { UserCard } from '../../../api/contract/views';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { XIcon } from '../../../components/icons/animated/x';
import { Avatar } from '../../../components/Avatar';
import { SelectField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { usePersonName } from '../../../app/personName';
import type { Lang } from '../../../lib/dates';
import { actorContext } from '../../../lib/grammar';
import { personName } from '../../../lib/personName';
import { PickRow } from './DetailRows';

/**
 * A person as a choice. Someone outside the team joins it when picked, and the choice says so. The Arabic verb agrees with a woman
 * (audit 2026-10-03, PRJ-11). The name is in the screen language (owner item 12): the language of the same i18n that gives t.
 */
export function personOption(
  person: Pick<User, 'id' | 'name' | 'nameAr' | 'gender'>, onTeam: boolean, t: ReturnType<typeof useTranslation>['t'],
  lang: Lang = i18n.language === 'ar' ? 'ar' : 'en',
): string {
  const name = personName(person, lang);
  return onTeam ? name : t('taskSheet.joinsTeam', { name, context: actorContext(person) });
}

/** One helper: the picture, the name and, for an editor, the X that removes them. With `rows` it is a row of a Group on the phone. */
function HelperRow({ helper, rows, onRemove }: { helper: UserCard; rows: boolean; onRemove?: () => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const Row = rows ? 'div' : 'li';
  return (
    <Row className={rows ? 'flex min-h-12 items-center gap-3 ps-4 pe-1' : 'flex min-h-11 items-center gap-3'}>
      <Avatar user={helper} size={26} />
      <bdi className="min-w-0 flex-1 truncate">{nameOf(helper)}</bdi>
      {onRemove && (
        <IconButton label={t('taskSheet.removeHelper', { name: nameOf(helper) })} onClick={onRemove}>
          <AnimatedIcon icon={XIcon} size={16} aria-hidden />
        </IconButton>
      )}
    </Row>
  );
}

/** The choices of the "Add a helper" picker: the empty choice, then each person who can still be added. */
function HelperOptions({ choices, teamIds }: { choices: User[]; teamIds: Set<string> }) {
  const { t } = useTranslation();
  return (
    <>
      <option value="">{t('taskSheet.pickHelper')}</option>
      {choices.map((person) => <option key={person.id} value={person.id}>{personOption(person, teamIds.has(person.id), t)}</option>)}
    </>
  );
}

/**
 * The people who help the lead (colleague comment 9). They tick checklist items and comment; the lead finishes the task.
 * The leader and the Admin add and remove them, and may pick someone outside the team, who then joins it.
 * Everyone else sees the list as plain text. An office task has no team, so its hint says nothing of one (hint, owner 2026-10-06).
 */
export function TaskHelpers({ helpers, leadId, people, teamIds, canEdit, onChange, hint, layout = 'plain' }: {
  helpers: UserCard[]; leadId: string | null; people: User[]; teamIds: Set<string>; canEdit: boolean; onChange: (helperIds: string[]) => void; hint?: string;
  /**
   * `rows` is the phone layout: a fragment of rows for a Group of the task panel (avatar, name and an X of 44 px for each helper, a quiet row
   * when an editor has none, and a last row that adds one). The hint then belongs to the Group. `plain` is the desk layout.
   */
  layout?: 'plain' | 'rows';
}) {
  const { t } = useTranslation();
  if (!canEdit && helpers.length === 0) return null;
  const ids = helpers.map((helper) => helper.id);
  const choices = people.filter((person) => person.id !== leadId && !ids.includes(person.id));
  if (layout === 'rows') {
    return (
      <>
        {helpers.length === 0 && <p className="flex min-h-12 items-center px-4 py-1.5 text-footnote text-ink-2">{t('taskSheet.noHelpers')}</p>}
        {helpers.map((helper) => (
          <HelperRow key={helper.id} helper={helper} rows onRemove={canEdit ? () => onChange(ids.filter((id) => id !== helper.id)) : undefined} />
        ))}
        {canEdit && ids.length < MAX_HELPERS && choices.length > 0 && (
          <PickRow id="task-add-helper" label={t('taskSheet.addHelper')} value="" display="" onChange={(value) => { if (value) onChange([...ids, value]); }}>
            <HelperOptions choices={choices} teamIds={teamIds} />
          </PickRow>
        )}
      </>
    );
  }
  return (
    <section aria-labelledby="task-helpers" className="flex flex-col gap-1">
      <h3 id="task-helpers" className="text-headline">{t('taskSheet.helpers')}</h3>
      {helpers.length === 0 && <p className="text-footnote text-label-2">{t('taskSheet.noHelpers')}</p>}
      <ul>
        {helpers.map((helper) => (
          <HelperRow key={helper.id} helper={helper} rows={false} onRemove={canEdit ? () => onChange(ids.filter((id) => id !== helper.id)) : undefined} />
        ))}
      </ul>
      {canEdit && ids.length < MAX_HELPERS && choices.length > 0 && (
        <SelectField
          id="task-add-helper"
          label={t('taskSheet.addHelper')}
          hint={hint ?? t('taskSheet.helpersHint')}
          value=""
          onChange={(event) => {
            if (event.target.value) onChange([...ids, event.target.value]);
          }}
        >
          <HelperOptions choices={choices} teamIds={teamIds} />
        </SelectField>
      )}
    </section>
  );
}
