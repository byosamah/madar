import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { usePersonName } from '../../../app/personName';
import { actorContext } from '../../../lib/grammar';

/**
 * The team of a to-do, the people that the viewer may pick, and the change of the lead. The task panel and the people list of a row both
 * read this hook, so the rule exists once. The leader and the Admin may pick anyone active, and a person outside the team joins it when
 * picked (colleague comment 9). The maker of a task who is not the leader picks only from the team (owner, 2026-10-07). An office to-do
 * has no team, so nobody joins one. This file imports no sheet package and no dnd-kit: the lazy people list reads it.
 *
 * `leadOnTeam` is the lead that counts as on the team. The panel passes its lead, so a lead who left the team still reads as on it. The
 * people list passes null.
 */
export function useLeadChoices<P extends { id: string }>({ taskId, humans, detail, leadOnTeam }: {
  taskId: string; humans: P[]; detail: ProjectDetail | null | undefined; leadOnTeam: { id: string } | null;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const teamIds = detail
    ? new Set([...detail.members.map((member) => member.user.id), ...(leadOnTeam ? [leadOnTeam.id] : []), ...(detail.leader ? [detail.leader.id] : [])])
    : new Set(humans.map((person) => person.id));
  const pickable = detail && !detail.viewerCan.editTeam ? humans.filter((person) => teamIds.has(person.id)) : humans;
  // A new lead gets the usual Undo toast. It also says when the person joined the team, and one Undo takes back both
  // (audit 2026-10-03, F-22).
  const joins = useRef(false);
  const newLead = useUndoable('tasks.update', {
    message: (output) => (output.owner
      ? t(joins.current ? 'taskSheet.newLeadJoined' : 'taskSheet.newLead', { name: nameOf(output.owner), context: actorContext(output.owner) })
      : t('lead.removed')),
  });
  const changeLead = (next: string | null) => {
    joins.current = next !== null && !teamIds.has(next);
    newLead.mutate({ id: taskId, patch: { ownerId: next } });
  };
  return { teamIds, pickable, changeLead };
}
