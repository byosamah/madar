import type { OfficeSnapshot } from '../core/types';

/**
 * The keep-dates rule of stages.replace for agents (owner, 2026-10-26). The call itself sets a date that the input leaves out to null, so an
 * agent that only renames or orders the stages would clear their dates. In the MCP layer, a stage that keeps an id and leaves out startDate (or
 * endDate) gets that date from the current stage of the same project, before the call runs. A null that the agent sends stays null. A stage
 * with no id is new and has no date to keep. The call still checks that every id is a stage of the project, so an id of another project
 * gets its refusal and no date of another project is copied.
 */
export function keepStageDates(args: Record<string, unknown>, office: OfficeSnapshot): Record<string, unknown> {
  const projectId = args.projectId;
  const stages = args.stages;
  if (typeof projectId !== 'string' || !Array.isArray(stages)) return args;
  const current = office.lists.stages;
  return {
    ...args,
    stages: stages.map((item) => {
      if (item === null || typeof item !== 'object') return item;
      const stage = item as Record<string, unknown>;
      const kept = typeof stage.id === 'string' ? current[stage.id] : undefined;
      if (!kept || kept.projectId !== projectId) return stage;
      return {
        ...stage,
        ...(stage.startDate === undefined ? { startDate: kept.startDate } : {}),
        ...(stage.endDate === undefined ? { endDate: kept.endDate } : {}),
      };
    }),
  };
}
