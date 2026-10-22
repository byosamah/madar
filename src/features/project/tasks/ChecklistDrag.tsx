import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMemo, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChecklistItem } from '../../../api/contract/entities';
import { ChecklistRow, ItemGrip } from './ChecklistRow';

/**
 * The drag part of the checklist (fbk_043). It holds everything of dnd-kit, so it is a chunk of its own: the first load draws the list
 * with the static rows of `TaskSheet.tsx`, and this layer takes their place once it has loaded (`checklistLayerLoader.ts`).
 */
// The options of the sensors are the same objects at each render, as in DragLayer.tsx.
const POINTER_OPTIONS = { activationConstraint: { distance: 4 } };
const KEYBOARD_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

export type DragChecklistProps = {
  items: ChecklistItem[]; edit: boolean; tick: boolean;
  onToggle: (id: string, done: boolean) => void; onRemove: (id: string) => void;
  /** One drop that changes the order calls this once, with the whole list in the new order. */
  onReorder: (next: ChecklistItem[]) => void;
  listRef: Ref<HTMLUListElement>;
};

function SortableItem({ item, edit, tick, onToggle, onRemove }: {
  item: ChecklistItem; edit: boolean; tick: boolean; onToggle: (id: string, done: boolean) => void; onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  // The item moves up and down only.
  const style = { transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition };
  const grip = <ItemGrip text={item.text} activatorRef={setActivatorNodeRef} handle={{ ...attributes, ...listeners }} />;
  return <ChecklistRow item={item} edit={edit} tick={tick} onToggle={onToggle} onRemove={onRemove} drag={{ ref: setNodeRef, style, lifted: isDragging, grip }} />;
}

export function DragChecklist({ items, edit, tick, onToggle, onRemove, onReorder, listRef }: DragChecklistProps) {
  const { t } = useTranslation();
  const sensors = useSensors(useSensor(PointerSensor, POINTER_OPTIONS), useSensor(KeyboardSensor, KEYBOARD_OPTIONS));
  const idsKey = items.map((item) => item.id).join(',');
  const ids = useMemo(() => (idsKey === '' ? [] : idsKey.split(',')), [idsKey]);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(items, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  // Screen readers hear the item text and its place in the list, in the screen language.
  const textOf = (id: UniqueIdentifier) => items.find((item) => item.id === String(id))?.text ?? '';
  const place = (id: UniqueIdentifier) => ({ n: ids.indexOf(String(id)) + 1, count: ids.length });
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('taskSheet.arrange.pickedUp', { text: textOf(active.id), ...place(active.id) }),
    onDragOver: ({ active, over }) => (over ? t('taskSheet.arrange.over', { text: textOf(active.id), ...place(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over
      ? t('taskSheet.arrange.dropped', { text: textOf(active.id), ...place(over.id) })
      : t('taskSheet.arrange.cancelled', { text: textOf(active.id) })),
    onDragCancel: ({ active }) => t('taskSheet.arrange.cancelled', { text: textOf(active.id) }),
  };
  return (
    <DndContext
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('taskSheet.arrange.instructions') } }}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul ref={listRef}>
          {items.map((item) => <SortableItem key={item.id} item={item} edit={edit} tick={tick} onToggle={onToggle} onRemove={onRemove} />)}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
