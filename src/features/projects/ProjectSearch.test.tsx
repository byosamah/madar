import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectSummary } from '../../api/contract/views';
import type { State } from '../../api/store';
import { workTabLink } from '../../app/lastList';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';
import { searchProjects } from './searchProjects';

// The project search and the Work header on the Projects view of a phone (phone design D, task W9). usr_001 is the Admin.
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const phone = () => phoneMedia({ phone: true, coarse: true });
const rows = () => {
  const list = screen.queryByRole('list', { name: 'Projects' });
  return list ? within(list).queryAllByRole('listitem') : [];
};
const ready = () => screen.findByRole('link', { name: /Corniche Office Tower/ });
const box = () => screen.getByRole('searchbox', { name: 'Search projects' });

// Each ProgressLine is one row body (the rule of ProjectRowRenders.test.tsx, RN-6).
const counts = vi.hoisted(() => ({ rows: 0 }));
vi.mock('../../components/ProgressLine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/ProgressLine')>();
  return { ...real, ProgressLine: (props: Parameters<typeof real.ProgressLine>[0]) => { counts.rows += 1; return createElement(real.ProgressLine, props); } };
});

describe('searchProjects', () => {
  const summary = (name: string, code: string, client: { name: string; nameAr: string } | null) => ({ project: { name, code }, client }) as unknown as ProjectSummary;
  const list = [
    summary('Corniche Office Tower', 'KH-001', { name: 'Al Rashid Group', nameAr: 'مجموعة الراشد' }),
    summary('Dune Line Townhouses', 'KH-002', { name: 'Dune Homes', nameAr: 'دون هومز' }),
    summary('No client project', 'KH-003', null),
  ];
  it('returns the same array for an empty query', () => {
    expect(searchProjects(list, '')).toBe(list);
    expect(searchProjects(list, '   ')).toBe(list);
  });
  it('matches the name, the code and the client in both languages', () => {
    expect(searchProjects(list, 'corniche').map((row) => row.project.code)).toEqual(['KH-001']);
    expect(searchProjects(list, 'kh-002').map((row) => row.project.code)).toEqual(['KH-002']);
    expect(searchProjects(list, 'rashid').map((row) => row.project.code)).toEqual(['KH-001']);
    expect(searchProjects(list, 'الراشد').map((row) => row.project.code)).toEqual(['KH-001']);
  });
  it('needs every word, in any order', () => {
    expect(searchProjects(list, 'tower corniche').map((row) => row.project.code)).toEqual(['KH-001']);
    expect(searchProjects(list, 'tower dune')).toEqual([]);
  });
  it('folds case and Arabic letters', () => {
    expect(searchProjects(list, 'CORNICHE')).toHaveLength(1);
    const arabic = [summary('برج أبراج', 'A-1', { name: 'X', nameAr: 'مؤسسة' })];
    expect(searchProjects(arabic, 'ابراج')).toHaveLength(1);
    expect(searchProjects(arabic, 'مؤسسه')).toHaveLength(1);
  });
  it('returns the same array when every row stays', () => {
    expect(searchProjects(list, 'kh')).toBe(list);
  });
});

describe('the project search on a phone', () => {
  it('matches the name, the code and the client names of a real project', async () => {
    phone();
    const { store } = await renderApp('/projects', as('usr_001'));
    await ready();
    const project = store.state.projects.prj_001!;
    const client = store.state.clients[project.clientId!]!;
    expect(rows()).toHaveLength(9);
    await userEvent.type(box(), 'corniche');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.clear(box());
    await userEvent.type(box(), project.code ?? "");
    await waitFor(() => expect(rows().length).toBeGreaterThanOrEqual(1));
    expect(screen.getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    await userEvent.clear(box());
    await userEvent.type(box(), client.name ?? '');
    await waitFor(() => expect(screen.getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument());
    await userEvent.clear(box());
    await userEvent.type(box(), client.nameAr ?? '');
    await waitFor(() => expect(screen.getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument());
  });

  it('keeps the text out of the link and out of the Filter count', async () => {
    phone();
    await renderApp('/projects', as('usr_001'));
    await ready();
    const before = window.location.hash;
    await userEvent.type(box(), 'corn');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    expect(window.location.hash).toBe(before);
    expect(window.location.hash).not.toMatch(/corn/);
  });

  it('shows the empty state and clears the text and the filters with Show all projects', async () => {
    phone();
    await renderApp('/projects?status=on_hold', as('usr_001'));
    await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ });
    await userEvent.type(box(), 'zzzz nothing');
    expect(await screen.findByText('No projects')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all projects' }));
    await waitFor(() => expect(box()).toHaveValue(''));
    await waitFor(() => expect(rows().length).toBeGreaterThan(9));
    expect(window.location.hash).toContain('status=all');
  });

  it('draws Work, three parts, then the search field and Filter on one row', async () => {
    phone();
    await renderApp('/projects', as('usr_001'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Work' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Show' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['To-dos', 'Meetings', 'Projects']);
    expect(within(group).getByRole('radio', { name: 'Projects' })).toBeChecked();
    expect(box()).toHaveClass('field');
    expect(await screen.findAllByRole('button', { name: 'New Project' })).toHaveLength(1);
    // The field and the Filter button share one row.
    const filter = screen.getByRole('button', { name: 'Filter' });
    expect(box().closest('div.flex')).toBe(filter.parentElement);
  });

  it('remembers Projects as the Work view of the tab bar', async () => {
    phone();
    await renderApp('/work', as('usr_001'));
    await userEvent.click(await screen.findByRole('radio', { name: 'Projects' }));
    expect(await screen.findByRole('searchbox', { name: 'Search projects' })).toBeInTheDocument();
    await waitFor(() => expect(workTabLink()).toBe('/projects'));
  });

  it('draws the gap chip and the health chip under the row', async () => {
    phone();
    await renderApp('/projects?filter=no_area&health=late', as('usr_001'));
    const gap = await screen.findByText('Projects with no area');
    const health = screen.getByText(/Late/, { selector: 'span.rounded-full' });
    const filter = screen.getByRole('button', { name: /^Filter/ });
    for (const chip of [gap, health]) {
      expect(filter.parentElement!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(filter.parentElement!.contains(chip)).toBe(false);
    }
  });

  it('renders no row again for a letter that keeps every row', async () => {
    phone();
    await renderApp('/projects', as('usr_001'));
    await ready();
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 80); }); });
    const before = counts.rows;
    // Every project name or code holds a hyphen or a letter "e" or "a": pick a letter that every row holds.
    const texts = rows().map((row) => row.textContent ?? '');
    const letter = 'abcdefghijklmnopqrstuvwxyz'.split('').find((l) => texts.every((text) => text.toLowerCase().includes(l)));
    if (!letter) return;
    fireEvent.change(box(), { target: { value: letter } });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 80); }); });
    expect(counts.rows - before).toBe(0);
  });

  it('keeps the desk as it is', async () => {
    phoneMedia({ phone: false });
    await renderApp('/projects', as('usr_001'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Show' })).toBeNull();
  });
});
