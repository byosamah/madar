/** What the agenda needs of a project row: its health, its pause, and its open client items. */
export type AgendaRow = {
  health: 'on_track' | 'at_risk' | 'late';
  pause: { staleDays: number | null } | null;
  openLoops: { client: number };
};

/** The group of a row: 0 late, 1 at risk, 2 stale or waiting for the client, 3 all others. */
function groupOf(row: AgendaRow): number {
  if (row.health === 'late') return 0;
  if (row.health === 'at_risk') return 1;
  if ((row.pause !== null && row.pause.staleDays !== null) || row.openLoops.client > 0) return 2;
  return 3;
}

/**
 * The meeting agenda (owner, 2026-10-02): the projects that need the team most come first.
 * Late, then at risk, then stale or waiting for the client, then all others. Inside a group the rows keep their input order.
 */
export function agendaOrder<T extends AgendaRow>(rows: readonly T[]): T[] {
  return rows.map((row, index) => ({ row, index, group: groupOf(row) }))
    .sort((a, b) => a.group - b.group || a.index - b.index)
    .map((item) => item.row);
}
