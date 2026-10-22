import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TaskDetail } from '../../../api/contract/views';
import { ProjectTile } from '../../../components/ProjectTile';
import type { TaskPanel } from './useTaskPanel';

/**
 * The start of the top row of the task panel on a phone: the picture and the name of the project, as a link to the project. An office to-do
 * has no project, so it shows the word Office and no link. The Sheet puts this node in place of its title text (the real title stays for
 * screen readers). The name is cut at its end, so a long name never pushes the Focus pill or the X out of the row.
 */
export function PhoneHeader({ data }: { data: TaskDetail }) {
  const { t } = useTranslation();
  const { project } = data;
  if (!project) return <span className="flex min-h-11 items-center text-subheadline font-semibold text-ink-2">{t('office.word')}</span>;
  return (
    <Link to={`/projects/${project.id}`} className="pressable flex min-h-11 min-w-0 max-w-full items-center gap-2 text-subheadline font-semibold text-ink">
      <ProjectTile id={project.id} mark={project.mark} size={22} />
      <bdi className="truncate">{project.name}</bdi>
    </Link>
  );
}

/**
 * The title of the to-do in large type. A person who may edit the details taps it, and the field takes the focus. A blur or Enter saves with
 * the rule of the desk field. Escape puts the old title back. The typed text lives in the panel (`title`), so the panel still saves it when it
 * closes by a tap outside or by Back. A reader sees plain text.
 */
export function TitleBlock({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const { task, canDetails, title, setTitle, patch } = panel;
  const [editing, setEditing] = useState(false);
  const shape = 'text-page-title break-words [text-wrap:balance]';
  if (!canDetails) return <p dir="auto" className={shape}><bdi>{task.title}</bdi></p>;
  if (!editing) {
    return (
      // The press area is 44 px high also for a title of one line (33.6 px high, 36.3 px in Arabic). The text sits in the middle of it.
      <button type="button" onClick={() => setEditing(true)} className={`pressable flex min-h-11 w-full items-center text-start ${shape}`}>
        <span dir="auto" className="block min-w-0 flex-1">{title}</span>
        <span className="sr-only"> {t('phoneTask.editTitle')}</span>
      </button>
    );
  }
  const save = () => {
    const next = title.trim();
    if (!next) setTitle(task.title);
    else if (next !== task.title) patch({ title: next });
    setEditing(false);
  };
  return (
    <input
      id="task-title"
      aria-label={t('taskSheet.title')}
      autoFocus
      dir="auto"
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setTitle(task.title);
          setEditing(false);
        }
      }}
      className={`field w-full ${shape}`}
    />
  );
}
