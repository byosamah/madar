import { AnimatePresence } from 'motion/react';
import { memo, useMemo, useRef } from 'react';
import type { User } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { todayISO } from '../../../lib/dates';
import type { RowGroupOf } from './DragLayer';
import { loadDragLayer, loadedDragLayer } from './dragLayerLoader';
import { useLayerSwap } from '../lazyLayer';
import { RowGrip } from './RowGrip';
import { TaskRowItem } from './TaskRowItem';

type Open = (row: TaskRow, thread?: boolean) => void;

/** One row of the static list: the row and its grip, with no drag. The same markup as a row of the drag layer. */
const StaticRow = memo(function StaticRow({ row, me, onOpen, sortable, showProject, today }: {
  row: TaskRow; me: User | undefined; onOpen: Open; sortable: boolean; showProject: boolean; today: string;
}) {
  const drag = useMemo(() => ({ lifted: false, still: false, grip: <RowGrip row={row} sortable={sortable} /> }), [row, sortable]);
  return <TaskRowItem row={row} me={me} onOpen={onOpen} showProject={showProject} today={today} drag={drag} />;
});

const dragLayer = { loaded: loadedDragLayer, load: loadDragLayer };

/**
 * The rows of one list that a person drags into a new order (owner, 2026-10-07). The order belongs to the tasks, so everyone who
 * sees them sees it. A drag never leaves the list and never changes a date: the Tasks screen uses one date group, the project task
 * list uses one stage. A list of more than one group (the Today list of Home) gives `groupOf`, and a drop in another group saves
 * nothing. With one task, with no task of the person, or with `draggable` off, it shows no grip.
 *
 * The drag itself (dnd-kit) is a chunk of its own (performance audit 2026-10-21, FL-2). The list first draws static rows with the
 * same markup, and a list with a grip loads the drag layer (`DragLayer.tsx`) and swaps it in. The swap makes new nodes without an
 * entrance (the layer has its own `AnimatePresence initial={false}`), and the focus goes back to the control that had it. A grip that is
 * pressed before the layer loads does nothing.
 */
export function SortableTaskRows({ rows, me, onOpen, showProject = false, draggable = true, listClassName, groupOf }: {
  rows: TaskRow[]; me: User | undefined; onOpen: Open; showProject?: boolean; draggable?: boolean; listClassName?: string; groupOf?: RowGroupOf;
}) {
  const sortable = draggable && rows.length > 1 && rows.some((row) => row.canMove);
  const listRef = useRef<HTMLUListElement>(null);
  const Layer = useLayerSwap(dragLayer, sortable, listRef);
  // The clock is read here and given to each row, so a row that did not change keeps its due word until the list renders again.
  const today = todayISO();
  if (Layer) {
    return <Layer rows={rows} me={me} onOpen={onOpen} showProject={showProject} sortable={sortable} today={today} listClassName={listClassName} listRef={listRef} groupOf={groupOf} />;
  }
  return (
    <ul ref={listRef} className={listClassName}>
      <AnimatePresence initial={false}>
        {rows.map((row) => <StaticRow key={row.task.id} row={row} me={me} onOpen={onOpen} sortable={sortable} showProject={showProject} today={today} />)}
      </AnimatePresence>
    </ul>
  );
}
