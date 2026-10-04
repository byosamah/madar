import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useCall } from '../../app/runtime';
import { renderApp, renderWithRuntime } from '../../test/render';
import { ProjectListRow } from './ProjectListRow';
import { absoluteLink } from './cardMenu';

function Card({ id }: { id: string }) {
  const summary = useCall('projects.list', { status: 'all' }).data?.find((s) => s.project.id === id);
  return summary ? <ul><ProjectListRow summary={summary} source="projects" /></ul> : null;
}

let saved: PropertyDescriptor | undefined;
function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  saved = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  if (saved) Object.defineProperty(window.navigator, 'clipboard', saved);
  else Reflect.deleteProperty(window.navigator, 'clipboard');
  saved = undefined;
});

async function copyFromMenu() {
  fireEvent.contextMenu(await screen.findByRole('link', { name: /Corniche Office Tower/ }), { clientX: 20, clientY: 20 });
  fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Copy link' }));
}

describe('the copied project link (plan R2, client map 7.4)', () => {
  it('makes a full link from the href of the router: a hash link in the prototype, a path link in the real build', () => {
    const { origin, pathname } = window.location;
    expect(absoluteLink('#/projects/prj_001')).toBe(`${origin}${pathname}#/projects/prj_001`);
    expect(absoluteLink('/projects/prj_001')).toBe(`${origin}/projects/prj_001`);
  });

  it('copies a hash link in the prototype, as before', async () => {
    const writeText = stubClipboard();
    await renderApp('/projects');
    await copyFromMenu();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const { origin, pathname } = window.location;
    expect(writeText).toHaveBeenCalledWith(`${origin}${pathname}#/projects/prj_001`);
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
  });

  it('copies a path link under a path router, as the real build uses', async () => {
    const writeText = stubClipboard();
    await renderWithRuntime(<Card id="prj_001" />, undefined, { path: '/' });
    await copyFromMenu();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/projects/prj_001`));
  });
});
