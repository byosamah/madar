import { useTranslation } from 'react-i18next';
import type { UserCard } from '../../../api/contract/views';
import { SelectField, TextField } from '../../../components/Fields';

/** Who answers a message that waits for our reply, and by which day. The two fields of the quick log and of the entry sheet. */
export function ReplyFields({ id, members, userId, dueDate, onUser, onDueDate }: {
  id: string;
  members: UserCard[];
  userId: string;
  dueDate: string;
  onUser: (userId: string) => void;
  onDueDate: (dueDate: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SelectField id={`${id}-who`} label={t('tracker.replyWho')} value={userId} onChange={(event) => onUser(event.target.value)} className="min-w-44 flex-1">
        {members.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
      </SelectField>
      <TextField id={`${id}-by`} type="date" label={t('tracker.replyBy')} value={dueDate} onChange={(event) => onDueDate(event.target.value)} className="min-w-40" />
    </div>
  );
}
