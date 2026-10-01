import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { Button } from './Button';
import { FilterButton } from './FilterButton';
import { ProgressLine } from './ProgressLine';
import { ProjectTile } from './ProjectTile';
import { StateWord } from './StateWord';
import { StatusSign } from './StatusSign';
import { Tabs } from './Tabs';

initI18n('en');

describe('calm parts', () => {
  it('draws a project picture: the Glow light in the project color and one form in ink', () => {
    const { container } = render(<ProjectTile id="prj_001" mark={30} />);
    const tile = container.querySelector('[data-project-mark]')!;
    expect(tile).toHaveAttribute('data-project-mark', '30');
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile.getAttribute('style')).toMatch(/radial-gradient.*--p-\w+-fg/);
    expect(tile.querySelector('svg path')).toHaveAttribute('fill', 'currentColor');
    expect(tile.textContent).toBe('');
  });

  it('shows a project state as a shape sign: the shape carries the color, the word stays in ink', () => {
    const { container } = render(<><StatusSign state="late">Late</StatusSign><StatusSign state="paused">Paused</StatusSign></>);
    const late = screen.getByText('Late');
    expect(late).toHaveAttribute('data-sign', 'late');
    expect(late).toHaveClass('text-ink');
    expect(late.querySelector('svg')).toHaveClass('text-red-text');
    expect(screen.getByText('Paused')).toHaveClass('text-ink-2');
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('reports the progress line value to screen readers', () => {
    render(<ProgressLine index={3} total={7} hue="blue" label="Stage 4 of 7" />);
    expect(screen.getByRole('progressbar', { name: 'Stage 4 of 7' })).toHaveAttribute('aria-valuenow', '50');
  });

  it('draws one piece per stage: finished stages soft, the current stage glowing, the stages to come grey', () => {
    const { container } = render(<ProgressLine index={3} total={7} hue="green" label="Stage 4 of 7" />);
    const steps = [...container.querySelectorAll('[data-step]')].map((piece) => piece.getAttribute('data-step'));
    expect(steps).toEqual(['done', 'done', 'done', 'now', 'next', 'next', 'next']);
    const now = container.querySelector('[data-step="now"]') as HTMLElement;
    expect(now).toHaveClass('step-now');
  });

  it('fills every piece and stops the glow when the project is complete', () => {
    const { container } = render(<ProgressLine index={6} total={7} complete hue="green" label="Completed" />);
    expect(screen.getByRole('progressbar', { name: 'Completed' })).toHaveAttribute('aria-valuenow', '100');
    expect([...container.querySelectorAll('[data-step]')].every((piece) => piece.getAttribute('data-step') === 'full')).toBe(true);
  });

  it('shows a state word with its tone', () => {
    render(<StateWord tone="late">Late</StateWord>);
    expect(screen.getByText('Late')).toHaveClass('text-late');
  });

  it('opens the filter choices, counts the active ones and returns focus on Escape', async () => {
    render(<FilterButton label="Filter" count={2}><p>Choices</p></FilterButton>);
    const button = screen.getByRole('button', { name: 'Filter, 2 active' });
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Filter' })).toHaveTextContent('Choices');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
    expect(button).toHaveFocus();
  });

  it('gives the one main button the signature, and the open tab a quiet underline', () => {
    render(<><Button variant="primary">Post update</Button><Tabs label="Sections" value="a" onChange={() => {}} options={[{ value: 'a', label: 'Overview' }, { value: 'b', label: 'Tasks' }]} /></>);
    expect(screen.getByRole('button', { name: 'Post update' })).toHaveClass('signature');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveClass('text-ink');
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveClass('text-ink-2');
  });
});

describe('person pictures', () => {
  it('use the Glow style: two soft lights in project hues, letters in ink', async () => {
    const { Avatar } = await import('./Avatar');
    render(<Avatar user={{ id: 'usr_001', name: 'Hala Nasser', avatarUrl: null, kind: 'human' }} />);
    const picture = screen.getByRole('img', { name: 'Hala Nasser' });
    expect(picture.getAttribute('style')).toMatch(/radial-gradient/);
    expect(picture.getAttribute('style')).toMatch(/--p-\w+-fg/);
    expect(picture).toHaveClass('text-ink');
    expect(picture).toHaveTextContent('HN');
  });
});
