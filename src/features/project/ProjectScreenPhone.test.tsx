import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { rememberProjectsList } from '../../app/lastList';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';
import { clearLivePostDrafts } from './overview/postDraft';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';

afterEach(() => {
  vi.restoreAllMocks();
  clearLivePostDrafts();
  window.localStorage.clear();
});

/** A phone that asks for less motion: it answers (prefers-reduced-motion: reduce) and leaves the phone query to phoneMedia. */
function reduceMotion() {
  const before = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const base = before.call(window, query);
    return query.includes('prefers-reduced-motion') ? { ...base, matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined } : base;
  }) as typeof window.matchMedia;
  onTestFinished(() => { window.matchMedia = before; });
}

function anchorAt(top: number) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-tab-anchor')) return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    return original.call(this);
  });
}

describe('the tab row of the project page on a phone (phone D, P6)', () => {
  it('shows five equal tabs, in this order, and lights More for its pages', async () => {
    phoneMedia(true);
    await renderApp(`${PROJECT}?tab=schedule`, as('usr_002'));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'To-dos', 'Tracker', 'Files & Links', 'More']);
    expect(screen.getByRole('tab', { name: 'More' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-more');
  });

  it('keeps the filters when the tab changes', async () => {
    phoneMedia(true);
    await renderApp(`${PROJECT}?tab=tasks&show=mine`, as('usr_002'));
    await userEvent.click(await screen.findByRole('tab', { name: 'Tracker' }));
    expect(window.location.hash).toBe('#/projects/prj_001?tab=tracker&show=mine');
  });

  it('makes the row sticky on a solid page color', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, as('usr_002'));
    const row = (await screen.findByRole('tablist')).closest('.sticky') as HTMLElement;
    expect(row).toHaveClass('top-[env(safe-area-inset-top)]', 'bg-bg');
  });

  it('scrolls to the tab row when the header is out of view, and not when it is in view', async () => {
    phoneMedia(true);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    anchorAt(-300);
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('tab', { name: 'To-dos' }));
    expect(scroll).toHaveBeenCalledWith({ top: window.scrollY - 300, behavior: 'smooth' });
  });

  it('does not scroll when the header is in view', async () => {
    phoneMedia(true);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    anchorAt(20);
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('tab', { name: 'To-dos' }));
    // The router restores its own scroll place with plain numbers. The tab row would call with an options object.
    expect(scroll.mock.calls.filter((call) => typeof call[0] === 'object')).toEqual([]);
  });

  it('jumps instead of gliding under reduced motion', async () => {
    phoneMedia(true);
    reduceMotion();
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    anchorAt(-300);
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('tab', { name: 'To-dos' }));
    expect(scroll).toHaveBeenCalledWith({ top: window.scrollY - 300, behavior: 'auto' });
  });

  it('sends ?tab=activity&compose=1 to the box on Overview', async () => {
    phoneMedia(true);
    Element.prototype.scrollIntoView = vi.fn();
    await renderApp(`${PROJECT}?tab=activity&compose=1`, as('usr_002'));
    const box = await screen.findByRole('textbox', { name: 'Post an update' });
    expect(window.location.hash).toContain('tab=overview');
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('writes the tab words in Arabic', async () => {
    phoneMedia(true);
    await renderApp(PROJECT, (state) => { state.users.usr_001.preferences.language = 'ar'; });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['نظرة عامة', 'المهام', 'المتابعة', 'الملفات والروابط', 'المزيد']);
  });

  it('sends "Project not found" back to the remembered Projects list on a phone', async () => {
    phoneMedia(true);
    rememberProjectsList('?filter=mine');
    onTestFinished(() => rememberProjectsList(''));
    await renderApp('/projects/prj_999');
    await screen.findByText('This project does not exist anymore.');
    const links = screen.getAllByRole('link', { name: 'Projects' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('href', '#/projects?filter=mine');
  });

  it('keeps the seven desk tabs on a desk', async () => {
    await renderApp(PROJECT, as('usr_002'));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'To-dos', 'Activity', 'Tracker', 'Schedule', 'Files & Links', 'Team']);
    expect(document.querySelector('[data-tab-anchor]')).toBeNull();
  });

  it('keeps the link /projects on the "Project not found" page of a desk', async () => {
    rememberProjectsList('?filter=mine');
    onTestFinished(() => rememberProjectsList(''));
    await renderApp('/projects/prj_999');
    await screen.findByText('This project does not exist anymore.');
    const links = screen.getAllByRole('link', { name: 'Projects' });
    expect(links.map((link) => link.getAttribute('href'))).toContain('#/projects');
  });
});
