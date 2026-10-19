import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { mcpTools } from './tools';

// fbk_025 (owner, 2026-10-19): the restart date of a pause is a reminder, never an automatic restart.
describe('the agent docs of the restart date of a pause (fbk_025)', () => {
  it('say in the instructions that the date is a reminder and that Madar never restarts a project by itself', () => {
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Pauses:'));
    expect(line).toBeDefined();
    for (const word of ['project.pause.resumeOn', 'reminder only', 'never restarts the project by itself', 'the person who paused']) expect(line, word).toContain(word);
  });

  it('say it in projects.setStatus, the call that names a pause', () => {
    expect(TOOL_DOCS['projects.setStatus'].description).toContain('reminder only');
    expect(TOOL_DOCS['projects.setStatus'].description).toContain('never restarts a project by itself');
  });

  it('give an agent no call to pause, resume or move the date', () => {
    const names = mcpTools().map((tool) => tool.name);
    for (const name of ['projects.pause', 'projects.resume', 'projects.setRestart']) expect(names).not.toContain(name);
  });
});
