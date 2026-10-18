import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../../components/icons/animated/grip-vertical';
import { reorderStages, type DraftStage, type TemplateDraft } from './templateDraft';

/** What the card of a stage gets from the list: the grip, the only drag handle, and whether a drag lifts the card. */
export type StageDrag = { grip: ReactNode; lifted: boolean };

/** One stage of the list: a list item that moves up and down with its drag, and the card that `render` draws in it. */
function SortableStage({ stage, index, render }: {
  stage: DraftStage; index: number; render: (stage: DraftStage, index: number, drag: StageDrag) => ReactNode;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  // The stage moves up and down only.
  const style: CSSProperties = { transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition };
  const grip = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={t('projectTemplates.stageGrip', { n: index + 1 })}
      className="grid h-11 w-11 shrink-0 cursor-grab touch-none place-items-center rounded-full text-label-3 hover:bg-fill active:cursor-grabbing"
    >
      <AnimatedIcon icon={GripVerticalIcon} size={16} aria-hidden />
    </button>
  );
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'relative z-10' : undefined}>
      {render(stage, index, { grip, lifted: isDragging })}
    </li>
  );
}

/**
 * The stages of a project template in a new order by drag (owner, 2026-10-18, fbk_008 item 2). A grip at the start of each card
 * is the only drag handle: Space picks a stage up, the arrow keys move it, and Space drops it. The stage menu keeps Move up and
 * Move down. A drop changes the draft only: the editor saves the order with the rest of the template.
 */
export function SortableStages({ draft, setDraft, render }: {
  draft: TemplateDraft; setDraft: (draft: TemplateDraft) => void; render: (stage: DraftStage, index: number, drag: StageDrag) => ReactNode;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Escape cancels a stage move, and the sheet around the list also closes on Escape. The window hears the key first.
  // While a stage moves, the key belongs to the move, so the sheet stays open.
  const moving = useRef(false);
  useEffect(() => {
    const holdEscape = (event: KeyboardEvent) => {
      if (moving.current && (event.key === 'Escape' || event.code === 'Escape')) event.preventDefault();
    };
    window.addEventListener('keydown', holdEscape, true);
    return () => window.removeEventListener('keydown', holdEscape, true);
  }, []);
  const ids = draft.stages.map((stage) => stage.id);
  // Screen readers hear the stage name and its place in the list. A stage with no name says its number instead.
  const titleOf = (stageId: UniqueIdentifier) => {
    const index = ids.indexOf(String(stageId));
    return draft.stages[index]?.name.trim() || t('projectTemplates.stageUntitled', { n: index + 1 });
  };
  const place = (stageId: UniqueIdentifier) => ({ n: ids.indexOf(String(stageId)) + 1, count: ids.length });
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('work.arrange.pickedUp', { title: titleOf(active.id), ...place(active.id) }),
    onDragOver: ({ active, over }) => (over ? t('work.arrange.over', { title: titleOf(active.id), ...place(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over
      ? t('work.arrange.dropped', { title: titleOf(active.id), ...place(over.id) })
      : t('tasks.dnd.cancelled', { title: titleOf(active.id) })),
    onDragCancel: ({ active }) => t('tasks.dnd.cancelled', { title: titleOf(active.id) }),
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    moving.current = false;
    if (!over || active.id === over.id) return;
    setDraft(reorderStages(draft, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('projectTemplates.stageInstructions') } }}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => { moving.current = true; }}
      onDragEnd={onDragEnd}
      onDragCancel={() => { moving.current = false; }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-3">
          {draft.stages.map((stage, index) => <SortableStage key={stage.id} stage={stage} index={index} render={render} />)}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
