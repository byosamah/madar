import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { Button } from './Button';
import { FilterButton } from './FilterButton';
import { ProgressLine } from './ProgressLine';
import { ProjectTile } from './ProjectTile';
import { StateWord } from './StateWord';
import { Tabs } from './Tabs';

initI18n('en');

describe('calm parts', () => {
  it('draws a project tile with two letters in the project hue', () => {
    render(<ProjectTile id="prj_001" name="Corniche Office Tower" />);
    const tile = screen.getByText('CO');
    expect(tile.getAttribute('style')).toMatch(/--p-\w+-bg/);
    expect(tile).toHaveAttribute('aria-hidden', 'true');
  });

  it('reports the progress line value to screen readers', () => {
    render(<ProgressLine value={0.5} hue="blue" label="Stage 3 of 7" />);
    expect(screen.getByRole('progressbar', { name: 'Stage 3 of 7' })).toHaveAttribute('aria-valuenow', '50');
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
