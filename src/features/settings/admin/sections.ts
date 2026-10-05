import type { ComponentType } from 'react';
import type { SystemRole } from '../../../api/contract/entities';
import { REMOTE } from '../../../app/mode';
import { ClientsSection } from './ClientsSection';
import { FeedbackSection } from './FeedbackSection';
import { OfficeSection } from './OfficeSection';
import { PeopleSection } from './PeopleSection';
import { ProjectTemplatesSection } from './ProjectTemplatesSection';
import { TaskTemplatesSection } from './TaskTemplatesSection';
import { TeamsSection } from './TeamsSection';
import { UsageSection } from './UsageSection';

/** The groups of the Admin side list, in the order of the list (owner, 2026-10-05, item 4). Each has a word at adminNav.groups.<group>. */
export const ADMIN_GROUPS = ['people', 'office', 'templates', 'system'] as const;
export type AdminGroup = (typeof ADMIN_GROUPS)[number];

/** One section of the Admin page. It opens at /admin/<id>. The section draws its own panel and its own title. */
export type AdminSection = {
  /** The last part of the section link: lower-case words with hyphens. */
  id: string;
  group: AdminGroup;
  /** The word of the row in the side list. Use the title key that the section uses for its own heading. */
  titleKey: string;
  /** The roles that see the section. The API refuses the calls of the section for every other role too. */
  roles: readonly SystemRole[];
  Component: ComponentType;
  /** True for a section that only the real build can fill (Usage reads the server meters). */
  remoteOnly?: boolean;
};

/**
 * Every section of the Admin page. To add a section, add one line here. The list puts each line inside its group, so the place
 * of a line in this array counts only inside its group.
 * Management makes and changes people and the office teams. The office settings, the templates, the requests and bugs, and
 * the free plan meters stay with the Admin.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { id: 'people', group: 'people', titleKey: 'admin.people', roles: ['admin', 'management'], Component: PeopleSection },
  { id: 'teams', group: 'people', titleKey: 'teams.title', roles: ['admin', 'management'], Component: TeamsSection },
  { id: 'office', group: 'office', titleKey: 'admin.office', roles: ['admin'], Component: OfficeSection },
  { id: 'clients', group: 'office', titleKey: 'clientsAdmin.title', roles: ['admin'], Component: ClientsSection },
  { id: 'project-templates', group: 'templates', titleKey: 'projectTemplates.title', roles: ['admin'], Component: ProjectTemplatesSection },
  { id: 'task-templates', group: 'templates', titleKey: 'taskTemplates.title', roles: ['admin'], Component: TaskTemplatesSection },
  { id: 'feedback', group: 'system', titleKey: 'feedback.adminTitle', roles: ['admin'], Component: FeedbackSection },
  { id: 'usage', group: 'system', titleKey: 'usage.title', roles: ['admin'], Component: UsageSection, remoteOnly: true },
];

/** The sections that this role sees in this build, in the order of the list: group by group, then in the order of the array. */
export function sectionsFor(role: SystemRole, remote: boolean = REMOTE, all: readonly AdminSection[] = ADMIN_SECTIONS): AdminSection[] {
  const visible = all.filter((section) => section.roles.includes(role) && (remote || !section.remoteOnly));
  return ADMIN_GROUPS.flatMap((group) => visible.filter((section) => section.group === group));
}

/** The sections in their groups, for the side list. A group with no section for the role is left out. */
export function groupsFor(sections: readonly AdminSection[]): { group: AdminGroup; sections: AdminSection[] }[] {
  return ADMIN_GROUPS
    .map((group) => ({ group, sections: sections.filter((section) => section.group === group) }))
    .filter((entry) => entry.sections.length > 0);
}
