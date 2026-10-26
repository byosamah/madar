import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type UniqueIdentifier,
} from '@dnd-kit/core';
import { createElement, useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDragContext, FRAME, placeKey, samePlace, type FileDragSlots, type Place, type RowSlotProps, type ZoneSlotProps } from './fileDragSlots';

/**
 * The drag part of the Files & Links list (fbk_066, owner 2026-10-26). It holds everything of dnd-kit, so it is a chunk of its own: the
 * first load draws the list with the static rows and zones of `fileDragSlots.tsx`, and this layer takes their place once it has loaded
 * (`filesDragLoader.ts`). A file row lifts with the pointer. A stage group, "No stage" and a folder take the file. There is no keyboard
 * drag: "Move to" in the file menu is the keyboard path, and the phone path.
 */
// The options of the sensor are one object for the life of the page, as in DragLayer.tsx.
const POINTER_OPTIONS = { activationConstraint: { distance: 6 } };

/** The zone under the pointer; when zones sit inside each other (a folder in a stage group), the smallest one wins. */
const innermost: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length <= 1) return hits;
  const area = (id: UniqueIdentifier) => {
    const rect = args.droppableRects.get(id);
    return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY;
  };
  return [...hits].sort((a, b) => area(a.id) - area(b.id));
};

function assign<T>(ref: RowSlotProps['liRef'], node: T | null): void {
  if (typeof ref === 'function') ref(node as HTMLLIElement | null);
  else if (ref) (ref as { current: T | null }).current = node;
}

function DragRow({ fileId, className = '', liRef, children }: RowSlotProps) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: fileId });
  const ref = useCallback((node: HTMLLIElement | null) => {
    setNodeRef(node);
    assign(liRef, node);
  }, [setNodeRef, liRef]);
  // No dnd-kit attributes: a row is not a button, and the keyboard moves a file with "Move to".
  return <li ref={ref} {...listeners} className={`${className} ${isDragging ? 'opacity-40' : ''}`}>{children}</li>;
}

function DragZone({ place, as, className = '', framed, native, children, ...rest }: ZoneSlotProps) {
  const { setNodeRef, isOver } = useDroppable({ id: placeKey(place), data: { place } });
  return createElement(as, { ref: setNodeRef, className: `${className} ${framed || isOver ? FRAME : ''}`, ...native, ...rest }, children);
}

const SLOTS: FileDragSlots = { Row: DragRow, Zone: DragZone };

export type FilesDragHostProps = {
  children: ReactNode;
  nameOf: (fileId: string) => string;
  /** The words of a place: a stage, a stage and a folder, or No stage. */
  placeText: (place: Place) => string;
  /** Where the file sits now. A drop there changes nothing. */
  placeOf: (fileId: string) => Place | undefined;
  onMove: (fileId: string, place: Place) => void;
};

export function FilesDragHost({ children, nameOf, placeText, placeOf, onMove }: FilesDragHostProps) {
  const { t } = useTranslation();
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTIONS));
  const [lifted, setLifted] = useState<string | null>(null);
  const placeFrom = (over: { data: { current?: { place?: Place } } } | null): Place | undefined => over?.data.current?.place;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setLifted(null);
    const place = placeFrom(over);
    const id = String(active.id);
    if (!place) return;
    const now = placeOf(id);
    if (now && samePlace(now, place)) return;
    onMove(id, place);
  };
  // Screen readers hear the file and the place in the screen language.
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('folders.announce.start', { name: nameOf(String(active.id)) }),
    onDragOver: ({ active, over }) => {
      const place = placeFrom(over);
      return place ? t('folders.announce.over', { name: nameOf(String(active.id)), place: placeText(place) }) : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const place = placeFrom(over);
      return place ? t('folders.announce.drop', { name: nameOf(String(active.id)), place: placeText(place) }) : t('folders.announce.cancel', { name: nameOf(String(active.id)) });
    },
    onDragCancel: ({ active }) => t('folders.announce.cancel', { name: nameOf(String(active.id)) }),
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={innermost}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('folders.dragHelp') } }}
      onDragStart={({ active }) => setLifted(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setLifted(null)}
    >
      <FileDragContext.Provider value={SLOTS}>{children}</FileDragContext.Provider>
      <DragOverlay dropAnimation={null}>
        {lifted ? <div dir="auto" className="surface max-w-xs truncate rounded-xl px-3 py-2 text-subheadline font-medium shadow-lg">{nameOf(lifted)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
