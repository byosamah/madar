import type { ProjectFolder } from '../../../api/contract/entities';
import { createContext, createElement, type ComponentType, type HTMLAttributes, type ReactNode, type Ref } from 'react';

/**
 * Where a file can sit in a project (fbk_066): a stage (null: No stage) and a folder of that stage (null: the root of the stage).
 */
export type Place = { stageId: string | null; folderId: string | null };

/** One text for a place, used as the id of a drop zone and to compare two places. */
export const placeKey = (place: Place): string => `${place.stageId ?? 'none'}:${place.folderId ?? 'root'}`;
/** The folders of a project detail. An answer of an older server has none. */
export const foldersOf = (detail: { folders?: ProjectFolder[] }): ProjectFolder[] => detail.folders ?? [];
export const samePlace = (a: Place, b: Place): boolean => a.stageId === b.stageId && a.folderId === b.folderId;

export type RowSlotProps = { fileId: string; name: string; className?: string; liRef?: Ref<HTMLLIElement>; children: ReactNode };
export type ZoneSlotProps = {
  place: Place;
  as: 'section' | 'div';
  className?: string;
  /** The frame of a file that comes from the computer (native drag and drop). A file row that is dragged in the page frames its zone itself. */
  framed?: boolean;
  /** The native handlers for a file that comes from the computer. */
  native?: Pick<HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  'aria-labelledby'?: string;
  role?: string;
  children: ReactNode;
};

/**
 * The two parts of the Files & Links list that a drag changes: a file row that can be lifted, and a zone that can take a file. The
 * first load draws them static (this file has no dnd-kit). The drag layer (`FilesDragLayer.tsx`, a chunk of its own, as the to-do drag
 * layer) gives its own pair in a context, and the list swaps to it once it has loaded.
 */
export type FileDragSlots = { Row: ComponentType<RowSlotProps>; Zone: ComponentType<ZoneSlotProps> };

export const FRAME = 'outline-2 outline-offset-2 outline-dashed outline-accent';

function StaticRow({ className, liRef, children }: RowSlotProps) {
  return <li ref={liRef} className={className}>{children}</li>;
}

function StaticZone({ as, className = '', framed, native, place: _place, children, ...rest }: ZoneSlotProps) {
  return createElement(as, { className: `${className} ${framed ? FRAME : ''}`, ...native, ...rest }, children);
}

export const staticSlots: FileDragSlots = { Row: StaticRow, Zone: StaticZone };

export const FileDragContext = createContext<FileDragSlots>(staticSlots);
