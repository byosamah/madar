import { z } from 'zod';
import { defineCall } from '../registry';
import { EventId, EventTarget, ProjectId } from '../contract/entities';
import { EventView } from '../contract/views';
import { forbidden, notFound } from '../errors';
import { undoEvent } from '../events';
import { can } from '../permissions';
import { eventViewOf } from '../views';
import { roleIn, touch } from './shared';

export const eventsList = defineCall({
  input: z.object({
    projectId: ProjectId.optional(),
    targetType: EventTarget.optional(),
    targetId: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  output: z.array(EventView),
  readOnly: true,
  run(input, ctx) {
    return Object.values(ctx.state.events)
      .filter((e) => (!input.projectId || e.projectId === input.projectId)
        && (!input.targetType || e.targetType === input.targetType)
        && (!input.targetId || e.targetId === input.targetId))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, input.limit)
      .map((e) => eventViewOf(ctx.state, e));
  },
});

export const eventsUndo = defineCall({
  input: z.object({ eventId: EventId }),
  output: EventView,
  run(input, ctx) {
    const event = ctx.state.events[input.eventId];
    if (!event) throw notFound('Event', input.eventId);
    // Your own changes and your agent's changes are yours to undo: the event names the person each acted for.
    const own = event.actingForId === ctx.authority.id;
    const agentChange = event.actorKind === 'agent' && event.projectId !== null
      && can(ctx.authority, 'event.undoAgent', { projectRole: roleIn(ctx, event.projectId) });
    if (!own && !agentChange) throw forbidden('You can undo changes by you or your agent, and agent changes on a project you lead.');
    const undo = undoEvent(ctx, event.id);
    if (event.projectId && ctx.state.projects[event.projectId]) touch(ctx, event.projectId);
    return eventViewOf(ctx.state, undo);
  },
});

export const historyCalls = {
  'events.list': eventsList,
  'events.undo': eventsUndo,
};
