import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { AnimatedIcon, type AnimatedIconComponent } from './AnimatedIcon';

const modules = import.meta.glob<Record<string, unknown>>('./animated/*.tsx', { eager: true });
const icons = Object.entries(modules).map(([path, exports]) => {
  const name = Object.keys(exports).find((key) => key.endsWith('Icon'))!;
  return [path.replace('./animated/', ''), exports[name] as AnimatedIconComponent] as const;
});

/** A control whose press re-renders the icon, as the Filter button does when its pop-over opens. */
function Holder({ icon }: { icon: AnimatedIconComponent }) {
  const [presses, setPresses] = useState(0);
  return (
    <button type="button" data-presses={presses} onClick={() => setPresses(presses + 1)}>
      <AnimatedIcon icon={icon} size={16} aria-hidden />
    </button>
  );
}

const BROKEN = /undefined|NaN/;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

/** Every value the icon writes into an attribute or a style, also a value that a later frame overwrites at once. */
function record(root: Element) {
  const broken: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const change of records) {
      const now = (change.target as Element).getAttribute(change.attributeName!) ?? '';
      if (BROKEN.test(change.oldValue ?? '') || BROKEN.test(now)) broken.push(`${(change.target as Element).tagName} ${change.attributeName}="${now}"`);
    }
  });
  observer.observe(root, { attributes: true, attributeOldValue: true, subtree: true });
  return {
    broken,
    stop: () => {
      for (const change of observer.takeRecords()) if (BROKEN.test(change.oldValue ?? '')) broken.push(`${(change.target as Element).tagName} ${change.attributeName}`);
      observer.disconnect();
    },
  };
}

// An animated attribute with no start value wrote "undefined" when a re-render came in the same moment as the first
// animation (audit 2026-10-03, V-31 on the sliders icon). Each icon now names its start state (audit 2026-10-03, S-3).
describe('every animated icon', () => {
  it.each(icons)('%s writes a real value in every state, also when a re-render comes as it starts and stops', async (_file, icon) => {
    const { container } = render(<Holder icon={icon} />);
    const watch = record(container);
    const button = screen.getByRole('button');
    // The focus starts the icon, and the press re-renders it in the same moment, before the first frame.
    act(() => {
      button.focus();
      button.click();
    });
    await wait(60);
    // The same at the stop: the focus leaves and a press re-renders in the same moment.
    act(() => {
      button.blur();
      button.click();
    });
    await wait(60);
    watch.stop();
    expect(watch.broken).toEqual([]);
  });
});
