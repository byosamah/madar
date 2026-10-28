import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { User } from '../../../api/contract/entities';
import type { ProjectSummary, TaskRow } from '../../../api/contract/views';
import type { MadarApi } from '../../../api/calls';
import { useUndoable } from '../../../app/actions';
import { usePersonName } from '../../../app/personName';
import { useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { Sheet } from '../../../components/Sheet';
import { actorContext, counted } from '../../../lib/grammar';
import { taskLink } from '../../../lib/params';
import { isLive } from '../../../lib/overview';
import { shownKey } from '../../../lib/projectLabel';
import { useProjectName } from '../../../app/projectName';

/** The sheet names this many open tasks. The count in its heading tells the rest. */
const SHOWN = 8;

type OpenWork = { projects: ProjectSummary[]; tasks: TaskRow[] };

/** The live projects a person leads, and their open tasks as lead or helper on those projects, from the existing calls. */
async function openWorkOf(api: MadarApi, id: string): Promise<OpenWork> {
  const [projects, tasks] = await Promise.all([
    api.call('projects.list', { status: 'all', sort: 'name' }),
    api.call('tasks.list', { ownerId: id, includeDone: false, activeProjectsOnly: false }),
  ]);
  const live = new Set(projects.filter((summary) => isLive(summary.project.status)).map((summary) => summary.project.id));
  return {
    projects: projects.filter((summary) => summary.project.leaderId === id && live.has(summary.project.id)),
    // The open office tasks of the person need a new lead too (owner, 2026-10-06).
    tasks: tasks.filter((row) => row.project === null || live.has(row.project.id)),
  };
}

/**
 * Deactivate for Admin, People. A person who still leads a live project or holds an open task gets a warning sheet first,
 * then the Admin may turn them off anyway. Madar never refuses. A person with no live work turns off at once, with Undo
 * (owner, 2026-10-03, API-7). When the check of their work fails, nobody turns off, and Retry asks again.
 */
export function useDeactivate(): { ask: (user: User) => void; sheet: ReactNode } {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const { api } = useRuntime();
  const toast = useToast();
  const [warning, setWarning] = useState<{ user: User; work: OpenWork } | null>(null);
  const deactivate = useUndoable('users.deactivate', { message: (user) => t('admin.deactivated', { name: nameOf(user) }) });
  const ask = (user: User) => {
    openWorkOf(api, user.id).then((work) => {
      if (work.projects.length === 0 && work.tasks.length === 0) deactivate.mutate({ id: user.id });
      else setWarning({ user, work });
    }, (error: unknown) => {
      toast.failed(error, { retry: () => ask(user) });
    });
  };
  const sheet = warning && (
    <DeactivateSheet
      user={warning.user}
      work={warning.work}
      onClose={() => setWarning(null)}
      onConfirm={() => {
        setWarning(null);
        deactivate.mutate({ id: warning.user.id });
      }}
    />
  );
  return { ask, sheet };
}

function DeactivateSheet({ user, work, onClose, onConfirm }: { user: User; work: OpenWork; onClose: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const projectName = useProjectName();
  const context = actorContext(user);
  const more = work.tasks.length - SHOWN;
  // A viewer who may not change the leader of a listed project, Management too, reads who does it. The right of each project
  // decides, so a custom role with the right reads no note. The links stay, to see the team (audit 2026-10-03, code review 2026-10-27).
  const adminChangesLeader = work.projects.some((summary) => !summary.viewerCan.changeLeader);
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('admin.deactivateTitle', { name: nameOf(user) })}
      // Only a leader reviews, so a person who leads no live project reads only the part about new work (audit 2026-10-03, warn repair).
      description={t(work.projects.length > 0 ? 'admin.deactivateBody' : 'admin.deactivateBodyTasks', { context })}
      footer={(
        <>
          {/* A double press must not turn the person off. Cancel takes the focus, and the confirm, with its own name, goes to
              the start side, away from the pointer, as the meeting restart does. */}
          <Button variant="destructive" className="me-auto" onClick={onConfirm}>{t('admin.deactivateAnyway')}</Button>
          <Button autoFocus onClick={onClose}>{t('common.cancel')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        {work.projects.length > 0 && (
          <section aria-labelledby="deactivate-leads" className="flex flex-col gap-1">
            <h3 id="deactivate-leads" className="text-headline">{t('admin.deactivateLeads', { context })}</h3>
            {adminChangesLeader && <p className="px-2 text-footnote text-label-2">{t('admin.deactivateLeaderByAdmin')}</p>}
            <ul>
              {work.projects.map(({ project }) => (
                <li key={project.id}>
                  {/* The Team tab is where the leader changes. */}
                  <Link to={`/projects/${project.id}?tab=team`} onClick={onClose} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
                    <span className="tabular text-footnote text-label-2">{shownKey(project, t)}</span>
                    <bdi className="min-w-0 flex-1 truncate">{projectName(project)}</bdi>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {work.tasks.length > 0 && (
          <section aria-labelledby="deactivate-tasks" className="flex flex-col gap-1">
            <h3 id="deactivate-tasks" className="text-headline">{counted(t, 'admin.deactivateTasks', work.tasks.length)}</h3>
            <ul>
              {work.tasks.slice(0, SHOWN).map(({ task, project }) => (
                <li key={task.id}>
                  <Link to={taskLink(project?.id ?? null, task.id)} onClick={onClose} className="flex min-h-11 flex-col justify-center rounded-xl px-2 py-1 hover:bg-fill">
                    <bdi className="truncate">{task.title}</bdi>
                    <bdi className="truncate text-footnote text-label-2">{project ? projectName(project) : t('office.word')}</bdi>
                  </Link>
                </li>
              ))}
            </ul>
            {more > 0 && <p className="px-2 text-footnote text-label-2">{counted(t, 'admin.deactivateMore', more)}</p>}
          </section>
        )}
      </div>
    </Sheet>
  );
}
