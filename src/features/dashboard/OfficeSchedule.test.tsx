import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the office schedule', () => {
  it('lists the active projects by target end date, each a link', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    const links = within(schedule).getAllByRole('link');
    expect(links).toHaveLength(9);
    await userEvent.click(within(schedule).getByRole('link', { name: /Open Corniche Office Tower/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('shows a project on one line and opens it to one line for each stage, with an overlap hatched', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    const school = within(schedule).getByRole('button', { name: /Eastern Shore Primary School/ });
    expect(school).toHaveAttribute('aria-expanded', 'false');
    expect(within(schedule).queryByText('Design Development')).toBeNull();
    const hatched = schedule.querySelectorAll('.overlap-hatch').length;
    await userEvent.click(school);
    expect(school).toHaveAttribute('aria-expanded', 'true');
    expect(within(schedule).getByText('Design Development')).toBeInTheDocument();
    expect(schedule.querySelectorAll('.overlap-hatch').length).toBeGreaterThan(hatched);
    await userEvent.click(school);
    expect(school).toHaveAttribute('aria-expanded', 'false');
    expect(within(schedule).queryByText('Design Development')).toBeNull();
  });

  // Every row has the width of the time scale, so one measure serves them all, not one ResizeObserver for each row (cleanup 2026-10-06).
  it('measures the time scale once for every row', async () => {
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      observe(node: Element): void { observed.push(node); }
      unobserve(): void {}
      disconnect(): void {}
    });
    onTestFinished(() => { vi.unstubAllGlobals(); });
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(schedule).getAllByRole('link')).toHaveLength(9);
    expect(observed.filter((node) => schedule.contains(node))).toHaveLength(1);
  });

  it('keeps the zoom for the next visit', async () => {
    const first = await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    await userEvent.click(within(schedule).getByRole('radio', { name: 'Month' }));
    first.unmount();
    await renderApp('/dashboard?view=schedule');
    const again = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(again).getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });

  it('names every color and mark in a legend', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    for (const word of ['Done stages', 'Current stage', 'Next stages', 'Deadline', 'Today', 'Two stages at the same time']) expect(within(schedule).getAllByText(word).length).toBeGreaterThan(0);
  });

  // A paused project draws its current stage in the same quiet grey as On track (owner, 2026-10-02), so its row says Paused
  // with the meeting's sign, and the legend names Paused when a paused row shows (audit 2026-10-03, V-7).
  it('says Paused beside a paused project, as the meeting does, and names Paused in the legend', async () => {
    await renderApp('/dashboard?view=schedule&status=all');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(within(schedule).getByRole('button', { name: /Tamr Staff Housing/ })).getByText(/^Stale/)).toBeInTheDocument();
    expect(within(within(schedule).getByRole('button', { name: /Gulf Crest HQ Interiors/ })).getByText('Awaiting client')).toBeInTheDocument();
    expect(within(within(schedule).getByRole('button', { name: /Corniche Office Tower/ })).queryByText(/Stale|Paused|Awaiting client/)).toBeNull();
    const legend = within(schedule).getByText('Paused');
    expect(legend.querySelector('span')?.className).toContain('bg-ink-2 text-bg');
  });

  it('leaves Paused out of the legend when no paused project shows', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(schedule).getByText('On track')).toBeInTheDocument();
    expect(within(schedule).queryByText('Paused')).toBeNull();
  });

  it('names its deadlines as buttons and its stages with their state, for keyboard and screen reader use (audit 2026-10-03, DSH-14)', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(schedule).getAllByRole('button', { name: /^Deadline: / }).length).toBeGreaterThan(0);
    expect(within(schedule).getAllByRole('img', { name: /, current$/ }).length).toBeGreaterThan(0);
    await userEvent.click(within(schedule).getByRole('button', { name: /Eastern Shore Primary School/ }));
    expect(within(schedule).getAllByRole('img', { name: /^Design Development, (done|current|next)$/ }).length).toBeGreaterThan(0);
  });

  it('uses the meeting colors: quiet grey deadlines, and the current stage in the color of the project state (audit 2026-10-03, DSH-15)', async () => {
    await renderApp('/dashboard?view=schedule');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    const barsOf = (name: string) => within(within(schedule).getByRole('button', { name: new RegExp(name) }).parentElement!.nextElementSibling as HTMLElement);
    const current = (name: string) => barsOf(name).getAllByRole('img', { name: /, current$/ })[0];
    expect(current('Shore Walk Retail Kiosks')).toHaveClass('bg-ink-2');
    expect(current('Al Waha Clinic Fit-out')).toHaveClass('bg-red-text');
    expect(current('Al Waha Clinic Fit-out').getAttribute('style') ?? '').not.toMatch(/--p-/);
    for (const diamond of within(schedule).getAllByRole('button', { name: /^Deadline: / })) expect(diamond.querySelector('.bg-attn')).toBeNull();
    // The legend says each state color in words.
    for (const word of ['On track', 'At risk', 'Late']) expect(within(schedule).getAllByText(word).length).toBeGreaterThan(0);
    expect(schedule.querySelector('.bg-attn')).toBeNull();
  });
});
