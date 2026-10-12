import { describe, expect, it } from 'vitest';
import { agentNamesOf } from './agentName';

// Owner, 2026-10-12: an agent was named after its AI app, so every agent read "Claude". Now it reads "<first name> <AI app> Agent",
// for example "Osama Claude Agent", and the Arabic name reads "وكيل <first name> <AI app>".
describe('the name of an agent user', () => {
  it('is the first name of the person, the AI app and "Agent"', () => {
    expect(agentNamesOf({ name: 'Osama Khalil' }, 'Claude')).toEqual({ name: 'Osama Claude Agent' });
    expect(agentNamesOf({ name: 'Faisal Al Howshani' }, 'ChatGPT')).toEqual({ name: 'Faisal ChatGPT Agent' });
    expect(agentNamesOf({ name: 'Tarek Khaled' }, 'Claude Code')).toEqual({ name: 'Tarek Claude Code Agent' });
  });

  it('is the first name and "Agent" when the AI app is not known', () => {
    for (const app of [null, '', '   ', 'AI agent']) expect(agentNamesOf({ name: 'Osama Khalil' }, app), String(app)).toEqual({ name: 'Osama Agent' });
  });

  it('does not say "Agent" twice when the AI app already ends with it', () => {
    expect(agentNamesOf({ name: 'Osama Khalil' }, 'Cursor Agent')).toEqual({ name: 'Osama Cursor Agent' });
    expect(agentNamesOf({ name: 'Osama Khalil' }, 'Codex agent')).toEqual({ name: 'Osama Codex agent' });
  });

  it('has an Arabic name only when the person has an Arabic name', () => {
    expect(agentNamesOf({ name: 'Osama Khalil', nameAr: 'أسامة خليل' }, 'Claude')).toEqual({ name: 'Osama Claude Agent', nameAr: 'وكيل أسامة Claude' });
    expect(agentNamesOf({ name: 'Osama Khalil', nameAr: 'أسامة خليل' }, null)).toEqual({ name: 'Osama Agent', nameAr: 'وكيل أسامة' });
    expect(agentNamesOf({ name: 'Osama Khalil', nameAr: '' }, 'Claude')).toEqual({ name: 'Osama Claude Agent' });
    expect(agentNamesOf({ name: 'Osama Khalil', nameAr: '   ' }, 'Claude')).toEqual({ name: 'Osama Claude Agent' });
  });

  it('takes the first word of a name with extra spaces, and the whole of a one-word name', () => {
    expect(agentNamesOf({ name: '  Osama   Khalil ' }, 'Claude')).toEqual({ name: 'Osama Claude Agent' });
    expect(agentNamesOf({ name: 'Madar' }, 'Claude')).toEqual({ name: 'Madar Claude Agent' });
  });

  it('keeps each name within the 80 characters that a name may have, and still ends with "Agent"', () => {
    const long = agentNamesOf({ name: 'Osama Khalil', nameAr: 'أسامة خليل' }, 'x'.repeat(200));
    expect(long.name).toHaveLength(80);
    expect(long.name.endsWith(' Agent')).toBe(true);
    expect(long.nameAr!.length).toBeLessThanOrEqual(80);
  });
});
