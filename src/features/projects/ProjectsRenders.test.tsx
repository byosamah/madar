import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

// Each render of a project row: the row body renders one ProgressLine (performance audit 2026-10-07, RND-2, RND-M1).
const rows = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../../components/ProgressLine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/ProgressLine')>();
  return {
    ...real,
    ProgressLine: (props: Parameters<typeof real.ProgressLine>[0]) => {
      rows.renders += 1;
      return createElement(real.ProgressLine, props);
    },
  };
});

/** Waits until the rows stop rendering: the late answers and the effects of the last step are in. */
async function settled(): Promise<number> {
  let last = -1;
  while (last !== rows.renders) {
    last = rows.renders;
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 40); }));
  }
  return rows.renders;
}

describe('Projects and the New project form (performance audit 2026-10-07, RND-2)', () => {
  it('does not render the project rows again when New project opens', async () => {
    await renderApp('/projects');
    await screen.findByRole('list', { name: 'Projects' });
    const before = await settled();
    expect(before).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'New Project' }));
    await screen.findByRole('dialog', { name: 'New Project' });
    expect(await settled()).toBe(before);
  });
});
