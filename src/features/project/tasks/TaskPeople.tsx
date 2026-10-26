import { Component, useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { lazyOverlay } from '../../../app/lazyOverlay';
import { useToast } from '../../../app/toasts';
import { reportError } from '../../../app/insight/notes';
import { Avatar } from '../../../components/Avatar';
import { AvatarStack } from '../../../components/AvatarStack';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { NoLeadMark } from '../../../components/NoLeadMark';

// The list is a part of its own: it holds the sheet of a phone, and the sheet package stays out of the first load (check-bundles).
// It follows the rule of every lazy part (`lazyOverlay`): a tab that opened before a release asks for a chunk that the host no longer
// has, and the first failed import reloads the page once to get the new build (fbk_064, 2026-10-26).
const peopleList = lazyOverlay(() => import('./TaskPeopleList').then((module) => module.default));
type Mode = 'lead' | 'helper';

/**
 * A fault inside the list closes the list and shows the toast of a failed step. It never takes the whole page down: the press of a
 * small control must not end in the error page of the route (fbk_064).
 */
class ListGuard extends Component<{ onFail: (error: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error, 'taskPeople');
    this.props.onFail(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The picture of the task people: the lead alone, the lead with the helpers, or the dashed mark of a task with no lead. */
function Picture({ row }: { row: TaskRow }) {
  if (!row.owner) return <NoLeadMark size={26} />;
  return row.helpers.length > 0
    ? <AvatarStack leader={row.owner} team={row.helpers} max={3} size={20} leaderSize={28} />
    : <Avatar user={row.owner} size={26} />;
}

/**
 * The people at the end of a task row. A person who may change them (`canEditPeople`) presses the picture to change the lead, and a
 * small "+" beside it (it shows on hover or focus, never on a touch screen or under 640 px) opens the helpers to add. No full task panel opens
 * (feedback fbk_006, 2026-10-11). Any other person sees the picture only. The rows keep one width, so the pictures line up.
 */
export function TaskPeople({ row }: { row: TaskRow }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState<{ mode: Mode; anchor: HTMLElement } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const setMode = useCallback((mode: Mode) => setOpen((current) => (current ? { ...current, mode } : current)), []);
  const failList = useCallback((error: unknown) => {
    setOpen(null);
    toast.failed(error);
  }, [toast]);
  if (!row.canEditPeople) {
    return (
      <span className="flex items-center">
        <Picture row={row} />
        <span aria-hidden className="ms-1 size-6 shrink-0 max-sm:hidden pointer-coarse:hidden" />
      </span>
    );
  }
  return (
    <span className="group/people flex items-center">
      <button
        type="button"
        aria-label={t('taskPeople.open', { title: row.task.title })}
        aria-haspopup="dialog"
        aria-expanded={open?.mode === 'lead'}
        onClick={(event) => setOpen({ mode: 'lead', anchor: event.currentTarget })}
        onPointerDown={peopleList.warm}
        className="pressable -m-1 flex items-center rounded-full p-1 max-sm:m-0 max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center max-sm:p-0"
      >
        <Picture row={row} />
      </button>
      <button
        type="button"
        aria-label={t('taskPeople.addHelperTo', { title: row.task.title })}
        aria-haspopup="dialog"
        aria-expanded={open?.mode === 'helper'}
        onClick={(event) => setOpen({ mode: 'helper', anchor: event.currentTarget })}
        className="pressable ms-1 grid size-6 shrink-0 place-items-center rounded-full bg-fill text-ink-2 opacity-0 transition-opacity hover:bg-fill-strong hover:text-ink focus-visible:opacity-100 group-hover/people:opacity-100 max-sm:hidden pointer-coarse:hidden motion-reduce:transition-none"
      >
        <AnimatedIcon icon={PlusIcon} size={14} aria-hidden />
      </button>
      {open && (
        <ListGuard onFail={failList}>
          <peopleList.Overlay row={row} mode={open.mode} anchor={open.anchor} onMode={setMode} onClose={close} />
        </ListGuard>
      )}
    </span>
  );
}
