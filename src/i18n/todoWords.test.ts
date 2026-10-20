import { describe, expect, it } from 'vitest';
import { ar, en } from './trees';

/** Every text of a word tree by its key. */
function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((out, [key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') out[path] = item;
    else Object.assign(out, flatten(item as Record<string, unknown>, path));
    return out;
  }, {});
}

/** The screen word for a task (owner, 2026-10-20): "Tasks" names the to-dos and the meetings together. */
describe('the screen word "to-do" (owner, 2026-10-20)', () => {
  const english = flatten(en as unknown as Record<string, unknown>);

  it('keeps "Tasks" only for the tab and the title of the screen', () => {
    expect(english['nav.tasks']).toBe('Tasks');
    expect(english['screens.myWork']).toBe('Tasks');
    const kept = Object.entries(english)
      .filter(([key, text]) => !key.startsWith('whatsNew.') && /\btasks?\b/i.test(text.replace(/\{\{[^}]*\}\}/g, '')))
      .map(([key]) => key);
    expect(kept.sort()).toEqual(['nav.tasks', 'screens.myWork']);
  });

  it('names the first option of the switch under the title "To-dos", and the project tab too', () => {
    expect(english['meetings.switch.todos']).toBe('To-dos');
    expect(english['project.tab.tasks']).toBe('To-dos');
  });

  it('changes only two Arabic texts: the option of the switch and the project tab', () => {
    const arabic = flatten(ar as unknown as Record<string, unknown>);
    expect(arabic['meetings.switch.todos']).toBe('قائمة المهام');
    expect(arabic['project.tab.tasks']).toBe('قائمة المهام');
    expect(arabic['nav.tasks']).toBe('المهام');
    expect(arabic['screens.myWork']).toBe('المهام');
  });
});
