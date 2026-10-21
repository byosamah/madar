import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Team, TeamId, UserId } from '../contract/entities';
import { TeamRow } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { nextId, teamsOf } from '../store';
import { cardOf } from '../views';
import { assertCan } from './shared';

const TeamName = z.string().trim().min(1).max(60);
const MemberIds = z.array(UserId).max(100);

function requireTeam(ctx: Ctx, id: string): Team {
  const team = teamsOf(ctx.state)[id];
  if (!team) throw notFound('Team', id);
  return team;
}

/** Names are unique ignoring case, so "design" and "Design" are one team. */
function assertNameFree(ctx: Ctx, name: string, exceptId: string | null): void {
  const key = name.toLowerCase();
  if (Object.values(teamsOf(ctx.state)).some((t) => t.id !== exceptId && t.name.toLowerCase() === key)) {
    throw invalid('name', 'A team with this name exists. Use another name.', 'duplicate_team');
  }
}

/** A team holds active people only. An agent acts for a person, so it never joins. Each person counts once. */
function checkedMembers(ctx: Ctx, ids: string[]): string[] {
  for (const id of ids) {
    const user = ctx.state.users[id];
    if (!user) throw notFound('User', id);
    if (user.kind !== 'human') throw invalid('memberIds', 'A team holds people only. An agent acts for a person.', 'agent_member');
    if (!user.active) throw invalid('memberIds', 'This person is not active.', 'inactive_member');
  }
  return [...new Set(ids)];
}

/** A team as a screen reads it: its active people as cards. A person who left the office is not shown. */
export function teamRowOf(ctx: Ctx, team: Team): TeamRow {
  const members = team.memberIds.filter((id) => ctx.state.users[id]?.active).map((id) => cardOf(ctx.state, id));
  return { ...team, members: members.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Everyone may read the teams: the Team filter and "Add a team" need the list. */
const teamsList = defineCall({
  input: z.object({}),
  output: z.array(TeamRow),
  readOnly: true,
  run(_input, ctx) {
    return Object.values(teamsOf(ctx.state)).sort((a, b) => a.name.localeCompare(b.name)).map((team) => teamRowOf(ctx, team));
  },
});

const teamsCreate = defineCall({
  input: z.object({ name: TeamName, memberIds: MemberIds.default([]) }),
  output: TeamRow,
  run(input, ctx) {
    assertCan(ctx, 'people.teams');
    assertNameFree(ctx, input.name, null);
    const id = nextId(ctx.state, 'tm');
    const team: Team = { id, name: input.name, memberIds: checkedMembers(ctx, input.memberIds) };
    teamsOf(ctx.state)[id] = team;
    recordCreate(ctx, { projectId: null, verb: 'team.created', targetType: 'team', targetId: id, entity: team });
    return teamRowOf(ctx, team);
  },
});

const teamsUpdate = defineCall({
  input: z.object({ id: TeamId, name: TeamName.optional(), memberIds: MemberIds.optional() }),
  output: TeamRow,
  run(input, ctx) {
    assertCan(ctx, 'people.teams');
    const team = requireTeam(ctx, input.id);
    if (input.name !== undefined) assertNameFree(ctx, input.name, team.id);
    const memberIds = input.memberIds ? checkedMembers(ctx, input.memberIds) : undefined;
    applyPatch(ctx, team, { name: input.name, memberIds }, { projectId: null, verb: 'team.updated', targetType: 'team', targetId: team.id });
    return teamRowOf(ctx, team);
  },
});

/** Deleting a team never changes a project: the people stay where they are. The Undo toast brings the team back. */
const teamsDelete = defineCall({
  input: z.object({ id: TeamId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    assertCan(ctx, 'people.teams');
    const team = requireTeam(ctx, input.id);
    delete teamsOf(ctx.state)[team.id];
    recordDelete(ctx, { projectId: null, verb: 'team.deleted', targetType: 'team', targetId: team.id, entity: team });
    return { deleted: true as const };
  },
});

export const teamCalls = {
  'teams.list': teamsList,
  'teams.create': teamsCreate,
  'teams.update': teamsUpdate,
  'teams.delete': teamsDelete,
};
