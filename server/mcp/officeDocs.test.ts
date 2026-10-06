import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';

/** The agent docs of office tasks: tasks with no project (owner, 2026-10-06). */
describe('the agent docs of office tasks (owner, 2026-10-06)', () => {
  it('explain office tasks in one line of the instructions: how to make one and who sees it', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Office tasks:'));
    expect(line).toBeDefined();
    for (const word of ['without projectId', 'maker', 'lead', 'helpers', 'Admin', 'no stage', 'no prerequisites', 'reviews']) expect(line, word).toContain(word);
  });

  it('say in tasks.create that a call with no projectId makes an office task that only its people and the Admin see', () => {
    const doc = TOOL_DOCS['tasks.create'].description;
    for (const word of ['projectId', 'office task', 'Admin']) expect(doc, word).toContain(word);
  });

  it('say in the read tools that an office task has no project, and how to list its files', () => {
    expect(TOOL_DOCS['tasks.get'].description).toContain('office task');
    expect(TOOL_DOCS['tasks.list'].description).toContain('office task');
    expect(TOOL_DOCS['files.list'].description).toContain('office task');
  });
});
