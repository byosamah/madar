import type { ComponentType } from 'react';
import { HoursTab } from './HoursTab';

export const WORK_TABS = ['tasks', 'hours'] as const;
export type WorkTab = (typeof WORK_TABS)[number];

/** The body of each My Work tab. Task 6 fills in the Hours tab. */
export const WORK_TAB_BODY: Record<WorkTab, ComponentType | null> = {
  tasks: null,
  hours: HoursTab,
};
