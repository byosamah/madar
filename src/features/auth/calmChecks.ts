import { expect } from 'vitest';
import { findPhysicalDirection } from '../../lib/rtl-check';

/**
 * The calm checks of plan 6.1, rule 8 (calm redesign spec, section 1.1), for a screen or a Settings section in its resting
 * state: one title, at most one main button, at most one colored highlight, and no physical left or right styles.
 * A main button has the signature fill. A colored highlight is the signature fill or a colored text or fill. Link text and an
 * error line after a failed step do not count: a person sees an error only after they act.
 */
const COLORED = /(?:^|\s)(?:signature|(?:text|bg|border|ring)-(?:late|red|orange|green|blue|amber|yellow|teal|violet|purple|pink|accent|p-[\w-]+)(?:-[\w-]+)?)(?=\s|$)/;

export function expectCalm(root: HTMLElement, o: { titleLevel?: 1 | 2 } = {}): void {
  const level = o.titleLevel ?? 1;
  expect(root.querySelectorAll(`h${level}`), `one level ${level} title`).toHaveLength(1);
  if (level === 2) expect(root.querySelectorAll('h1'), 'a section has no page title').toHaveLength(0);
  const main = [...root.querySelectorAll('button, a')].filter((element) => element.classList.contains('signature'));
  expect(main.length, 'at most one main button').toBeLessThanOrEqual(1);
  const colored = [...root.querySelectorAll('[class]')].filter((element) => COLORED.test(element.getAttribute('class') ?? ''));
  expect(colored.length, 'at most one colored highlight').toBeLessThanOrEqual(1);
  const styles = [...root.querySelectorAll('[class], [style]')].flatMap((element) => [element.getAttribute('class') ?? '', element.getAttribute('style') ?? '']);
  expect(findPhysicalDirection(styles.join('\n')), 'no physical left or right styles').toEqual([]);
}
