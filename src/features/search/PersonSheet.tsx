import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { UserCard } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { Sheet } from '../../components/Sheet';

/** A person from search: their discipline, email and active projects (plan clarification 8). */
export function PersonSheet({ person, onClose }: { person: UserCard; onClose: () => void }) {
  const { t } = useTranslation();
  const user = useCall('users.get', { id: person.id });
  const projects = useCall('projects.list', { status: 'active', sort: 'name' });
  const theirs = (projects.data ?? []).filter((summary) => summary.leader?.id === person.id || summary.team.some((member) => member.id === person.id));
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={person.name} description={person.discipline}>
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex items-center gap-3">
          <Avatar user={person} size={56} />
          {user.data && <p dir="ltr" className="break-all text-subheadline text-label-2">{user.data.email}</p>}
        </div>
        <section className="flex flex-col gap-1">
          <h3 className="text-headline">{t('person.projects')}</h3>
          {projects.data && theirs.length === 0 ? <p className="text-footnote text-label-2">{t('person.none')}</p> : (
            <ul>
              {theirs.map((summary) => (
                <li key={summary.project.id}>
                  <Link to={`/projects/${summary.project.id}`} onClick={onClose} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
                    <span className="tabular text-footnote text-label-2">{summary.project.code}</span>
                    <bdi className="min-w-0 flex-1 truncate">{summary.project.name}</bdi>
                    <span className="text-footnote text-label-2">{summary.leader?.id === person.id ? t('person.leads') : t('person.member')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
