import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';

/** The tools that a right opens name the switch of that right, because a custom role may hold it (role rights version 2, 2026-10-21). */
const PAYMENT_SWITCH: Record<string, string> = {
  'payments.create': 'payment.add',
  'payments.list': 'payment.view',
  'payments.markReceived': 'payment.receive',
  'payments.update': 'payment.change',
};

/** The tools that the project leader and the Admin used to own, with the switch that gates each one now. */
const LEADER_SWITCH: Record<string, string> = {
  'deadlines.create': 'project.deadlines',
  'deadlines.update': 'project.deadlines',
  'projects.setStatus': 'project.archive',
  'projects.update': 'project.details',
  'stages.setDates': 'project.stages',
  'stages.replace': 'project.stages',
  'tasks.approve': 'task.review',
  'tasks.sendBack': 'task.review',
};

describe('the agent docs name the switch of each right (role rights version 2)', () => {
  it('name the payment switch, with its default holders, in each payment tool', () => {
    for (const [name, id] of Object.entries(PAYMENT_SWITCH)) {
      expect(TOOL_DOCS[name].description, name).toContain(`(${id}): by default the Admin, Management and Accounting.`);
    }
  });

  it('name the switch of the leader in each tool that the leader and the Admin own by default', () => {
    for (const [name, id] of Object.entries(LEADER_SWITCH)) {
      expect(TOOL_DOCS[name].description, name).toContain(id);
      expect(TOOL_DOCS[name].description, name).toContain('by default');
    }
  });

  it('no longer speak of "the payment right", "the feedback right", "the code right" or "the report right" in a tool', () => {
    for (const [name, doc] of Object.entries(TOOL_DOCS)) {
      expect(doc.description, name).not.toMatch(/the (payment|feedback|code|report|gaps) right/);
      expect(doc.description, name).not.toContain('Only the Admin, Management and Accounting');
      expect(doc.description, name).not.toMatch(/(leader and the Admin may|leader or the Admin\) may) (do|add|change|approve)/);
    }
  });

  it('say in the instructions that the Admin sets the switches, and what a closed call does', () => {
    expect(INSTRUCTIONS).toContain('The Admin decides what each role and its AI assistants may do');
    expect(INSTRUCTIONS).toContain('ai_off');
    expect(INSTRUCTIONS).toContain('Never try another way.');
    const lines = INSTRUCTIONS.split('\n');
    const first = lines.findIndex((text) => text.startsWith('The Admin decides what each role'));
    // The two lines stand together: the Admin decides, then the closed call.
    expect(lines[first + 1].startsWith('A call that is off fails with the reason ai_off or forbidden.')).toBe(true);
  });

  it('replace the old "Role rights" paragraph with a "Switches" paragraph', () => {
    expect(INSTRUCTIONS).not.toContain('Role rights:');
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Switches:'));
    expect(line).toBeDefined();
    expect(line).toContain('You change the switches of a role only as an Admin\'s agent with roles.update');
  });

  it('name the switches for the review, the team, the minutes, the stage dates, the code and the chat messages in the instructions', () => {
    for (const word of ['task.review', 'project.team', 'meeting.minutesAny', 'project.stages', 'feedback.manage', 'ai.feedback', 'project.code', 'ai.readChats']) {
      expect(INSTRUCTIONS, word).toContain(word);
    }
    expect(INSTRUCTIONS).not.toMatch(/the (payment|feedback|code|report) right\b/);
  });
});
