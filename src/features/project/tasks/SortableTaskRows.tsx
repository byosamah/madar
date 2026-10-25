import { AnimatePresence } from 'motion/react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { User } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { todayISO } from '../../../lib/dates';
import type { DragRowsProps, RowGroupOf } from './DragLayer';
import { loadDragLayer, loadedDragLayer } from './dragLayerLoader';
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

const CONTROLS = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Where the focus is inside a list: the row and the control in it. The swap to the drag layer makes new nodes, so the focus goes there again. */
export type FocusMark = { row: number; control: number };

export function markFocus(list: HTMLUListElement | null): FocusMark | null {
  const active = document.activeElement;
  if (!list || !active || active === list || !list.contains(active)) return null;
  const rows = [...list.children];
  const row = rows.findIndex((item) => item.contains(active));
  if (row < 0) return null;
  const control = [...rows[row]!.querySelectorAll(CONTROLS)].indexOf(active);
  return control < 0 ? null : { row, control };
}

export function restoreFocus(list: HTMLUListElement | null, mark: FocusMark): void {
  const target = list?.children[mark.row]?.querySelectorAll<HTMLElement>(CONTROLS)[mark.control];
  target?.focus({ preventScroll: true });
}

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
  const [Layer, setLayer] = useState<ComponentType<DragRowsProps> | null>(loadedDragLayer);
  const listRef = useRef<HTMLUListElement>(null);
  const mark = useRef<FocusMark | null>(null);
  useEffect(() => {
    if (!sortable || Layer) return undefined;
    let live = true;
    loadDragLayer().then((layer) => {
      if (!live) return;
      mark.current = markFocus(listRef.current);
      setLayer(() => layer);
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [sortable, Layer]);
  useLayoutEffect(() => {
    if (!Layer || !mark.current) return;
    const kept = mark.current;
    mark.current = null;
    restoreFocus(listRef.current, kept);
  }, [Layer]);
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
