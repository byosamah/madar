import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { searchProjects } from './searchProjects';

/**
 * The screens show the Arabic name of a project when the screen is Arabic and the project has one, else the English name (owner,
 * 2026-10-26, fbk_062). English screens never change. prj_001 is "Corniche Office Tower" and prj_002 has no Arabic name here.
 */
const NAME_AR = 'برج الكورنيش للمكاتب';
const EN = 'Corniche Office Tower';

const arabic = (state: State) => {
  state.users.usr_001.preferences.language = 'ar';
  state.projects.prj_001.nameAr = NAME_AR;
};
const english = (state: State) => {
  state.projects.prj_001.nameAr = NAME_AR;
};
const LOAD = { timeout: 10_000 };

describe('the Projects list', () => {
  it('shows the Arabic name on an Arabic screen, and the English name for a project with none', async () => {
    await renderApp('/projects', arabic);
    const list = await screen.findByRole('list', { name: 'المشاريع' }, LOAD);
    expect(await within(list).findByText(NAME_AR)).toBeInTheDocument();
    expect(within(list).queryByText(EN)).toBeNull();
    // A project with no Arabic name keeps its English name.
    expect(within(list).getByText('Eastern Shore Primary School')).toBeInTheDocument();
  });

  it('shows the English name on an English screen, also when the project has an Arabic name', async () => {
    await renderApp('/projects', english);
    const list = await screen.findByRole('list', { name: 'Projects' }, LOAD);
    expect(await within(list).findByText(EN)).toBeInTheDocument();
    expect(within(list).queryByText(NAME_AR)).toBeNull();
  });
});

describe('the project page', () => {
  it('shows the Arabic name in the title on an Arabic screen', async () => {
    await renderApp('/projects/prj_001', arabic);
    expect(await screen.findByRole('heading', { level: 1, name: NAME_AR }, LOAD)).toBeInTheDocument();
  });

  it('keeps the English name in the title on an English screen', async () => {
    await renderApp('/projects/prj_001', english);
    expect(await screen.findByRole('heading', { level: 1, name: EN }, LOAD)).toBeInTheDocument();
  });
});

describe('the Inbox', () => {
  it('titles a project chat with the Arabic name on an Arabic screen', async () => {
    await renderApp('/inbox', arabic);
    expect(await screen.findByText(NAME_AR, undefined, LOAD)).toBeInTheDocument();
  });
});

describe('the search of the Projects list', () => {
  const rows = (...names: { name: string; nameAr?: string }[]) => names.map((n, i) => ({ project: { id: `prj_${i}`, code: `KH-26-00${i}`, ...n }, client: null })) as never;

  it('matches the Arabic name and the English name', () => {
    const list = rows({ name: 'Corniche Office Tower', nameAr: NAME_AR }, { name: 'Harbor Villa' });
    expect(searchProjects(list, 'الكورنيش')).toHaveLength(1);
    expect(searchProjects(list, 'Corniche')).toHaveLength(1);
    expect(searchProjects(list, 'Villa')).toHaveLength(1);
    expect(searchProjects(list, 'برج')).toHaveLength(1);
  });
});

describe('Search', () => {
  it('finds a project by its Arabic name and shows the Arabic name on an Arabic screen', async () => {
    await renderApp('/search', arabic);
    const box = await screen.findByRole('combobox', undefined, LOAD);
    await userEvent.type(box, 'الكورنيش');
    expect(await screen.findByText(NAME_AR, undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Eastern Shore Primary School')).toBeNull());
  });
});
