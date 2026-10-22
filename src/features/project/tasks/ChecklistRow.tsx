import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChecklistItem } from '../../../api/contract/entities';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { GripVerticalIcon } from '../../../components/icons/animated/grip-vertical';
import { XIcon } from '../../../components/icons/animated/x';
import { IconButton } from '../../../components/IconButton';

/**
 * The row of one checklist item that a person ticks or edits (fbk_043). The static list and the drag layer (`ChecklistDrag.tsx`, a chunk
 * of its own) draw the same row, so the swap changes no look. `drag` carries the dnd-kit parts: the node ref, the transform, the lift and
 * the grip.
 */
export type ItemDrag = { ref?: (node: HTMLElement | null) => void; style?: CSSProperties; lifted: boolean; grip: ReactNode };

export function ChecklistRow({ item, edit, tick, onToggle, onRemove, drag, rows = false }: {
  item: ChecklistItem; edit: boolean; tick: boolean; onToggle: (id: string, done: boolean) => void; onRemove: (id: string) => void; drag?: ItemDrag;
  /**
   * The phone layout (Direction D): the grip sits at the start with a 44 px target, the box and the text are one label (the tick area is the
   * row, not the 20 px box), and the X is a separate 44 px button. The desk layout is the default.
   */
  rows?: boolean;
}) {
  const { t } = useTranslation();
  if (rows) {
    return (
      <li ref={drag?.ref} style={drag?.style} className={`flex min-h-12 items-center ps-1 pe-1 ${drag?.lifted ? 'surface relative z-10 rounded-xl shadow-float' : ''}`}>
        {drag?.grip}
        <label className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 py-1 ${drag?.grip ? 'ps-1' : 'ps-3'} pe-2 ${tick ? 'cursor-pointer' : ''}`}>
          <input
            type="checkbox"
            aria-label={item.text}
            className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
            checked={item.done}
            disabled={!tick}
            onChange={(event) => onToggle(item.id, event.target.checked)}
          />
          <span dir="auto" className={`min-w-0 flex-1 break-words ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
        </label>
        {edit && (
          <IconButton label={t('taskSheet.removeItem', { text: item.text })} onClick={() => onRemove(item.id)}>
            <AnimatedIcon icon={XIcon} size={16} aria-hidden />
          </IconButton>
        )}
      </li>
    );
  }
  return (
    <li ref={drag?.ref} style={drag?.style} className={`flex min-h-11 items-center gap-3 rounded-xl ${drag?.lifted ? 'surface relative z-10 px-2 shadow-float' : ''}`}>
      <input
        type="checkbox"
        aria-label={item.text}
        className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
        checked={item.done}
        disabled={!tick}
        onChange={(event) => onToggle(item.id, event.target.checked)}
      />
      <span dir="auto" className={`min-w-0 flex-1 ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
      {edit && (
        <IconButton label={t('taskSheet.removeItem', { text: item.text })} onClick={() => onRemove(item.id)}>
          <AnimatedIcon icon={XIcon} size={16} aria-hidden />
        </IconButton>
      )}
      {drag?.grip}
    </li>
  );
}

/**
 * The grip at the end of a checklist item, with the look and the keys of the to-do rows (`RowGrip`): Space picks the item up, the arrow
 * keys move it, Space drops it. The static list draws it with no handle; the drag layer gives the activator ref and the listeners.
 */
export function ItemGrip({ text, activatorRef, handle, rows = false }: { text: string; activatorRef?: Ref<HTMLButtonElement>; handle?: ButtonHTMLAttributes<HTMLButtonElement>; rows?: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      ref={activatorRef}
      type="button"
      {...handle}
      aria-label={t('taskSheet.moveItem', { text })}
      // The sheet of a phone drags down from any place that is not marked, so the grip must not start that drag.
      data-vaul-no-drag
      className={`grid shrink-0 cursor-grab touch-none place-items-center rounded-full text-label-3 hover:bg-fill active:cursor-grabbing ${rows ? 'h-12 w-11' : 'h-11 w-8'}`}
    >
      <AnimatedIcon icon={GripVerticalIcon} size={16} aria-hidden />
    </button>
  );
}
