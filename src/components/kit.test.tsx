import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW } from '../test/factories';
import { Age } from './Age';
import { AvatarStack } from './AvatarStack';
import { ChipGroup } from './Chip';
import { TextField } from './Fields';
import { HealthPill } from './HealthPill';
import { RichText } from './RichText';
import { StageRail } from './StageRail';

beforeEach(() => {
  initI18n('en');
  setNow(NOW);
});

const person = (id: string, name: string) => ({ id, name, avatarUrl: null, kind: 'human' as const, discipline: 'Architect' });
const stage = (id: string, name: string, order: number) => ({ id, projectId: 'prj_001', name, order, startDate: null, endDate: null });

describe('the display kit', () => {
  it('selects one chip', async () => {
    const onChange = vi.fn();
    render(<ChipGroup label="Filters" value="all" options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }]} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(onChange).toHaveBeenCalledWith('mine');
  });

  it('links a field error to its input', () => {
    render(<TextField id="name" label="Name" error="Enter a name." value="" onChange={() => undefined} />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a name.');
  });

  it('shows the health word and who set it, or the project status', () => {
    const health = { value: 'at_risk' as const, computed: 'late' as const, overridden: true, reason: 'Client delay', setBy: 'usr_002' };
    const { rerender } = render(<HealthPill health={health} status="active" setBy={person('usr_002', 'Faisal Al-Harbi')} />);
    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('Set by Faisal Al-Harbi')).toBeInTheDocument();
    rerender(<HealthPill health={null} status="on_hold" setBy={null} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('names the current stage on the rail', () => {
    render(<StageRail stages={[stage('stg_001', 'Concept', 0), stage('stg_002', 'Permits', 1), stage('stg_003', 'Tender', 2)]} currentId="stg_002" />);
    expect(screen.getByRole('list', { name: 'Stage 2 of 3: Permits' })).toBeInTheDocument();
  });

  it('shows the leader first and counts the rest', () => {
    const team = [person('usr_005', 'Sara A'), person('usr_006', 'Yousef S'), person('usr_007', 'Lina M'), person('usr_008', 'Khalid M')];
    render(<AvatarStack leader={person('usr_002', 'Faisal Al-Harbi')} team={team} />);
    const avatars = screen.getAllByRole('img');
    expect(avatars[0]).toHaveAccessibleName('Faisal Al-Harbi');
    expect(avatars).toHaveLength(4);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  // In Arabic "+1" read "1+", and a 6 px overlap hid part of the initials of the picture under it (2026-10-05).
  it('keeps "+1" in that order in Arabic, and overlaps the pictures by 4 px only, so no initials hide', () => {
    const team = [person('usr_005', 'Sara A'), person('usr_006', 'Yousef S'), person('usr_007', 'Lina M'), person('usr_008', 'Khalid M')];
    render(<div dir="rtl"><AvatarStack leader={person('usr_002', 'Faisal Al-Harbi')} team={team} /></div>);
    const more = screen.getByText('+1');
    expect(more.tagName).toBe('BDI');
    expect(more).toHaveAttribute('dir', 'ltr');
    const [, second] = screen.getAllByRole('img');
    expect(second.parentElement).toHaveClass('-ms-1');
    expect(second.parentElement).not.toHaveClass('-ms-1.5');
  });

  it('can draw the leader bigger and names each picture on hover, in a label outside any clipping box', async () => {
    render(<div style={{ overflow: 'hidden' }}><AvatarStack leader={person('usr_002', 'Faisal Al-Harbi')} team={[person('usr_005', 'Sara A')]} size={26} leaderSize={30} /></div>);
    const [leader, member] = screen.getAllByRole('img');
    expect(leader).toHaveStyle({ width: '30px' });
    expect(member).toHaveStyle({ width: '26px' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.hover(member);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Sara A');
    expect(tip.closest('div[style]')).toBeNull();
    await userEvent.unhover(member);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows short ages', () => {
    render(<Age stamp="2026-09-30T08:55:00.000+03:00" />);
    expect(screen.getByText('5m')).toBeInTheDocument();
  });

  it('shows mentions and lets the post keep its own text direction', () => {
    const { container } = render(<RichText body="Please check @[Sara Al-Qahtani](usr_005)" />);
    expect(screen.getByText('@Sara Al-Qahtani')).toBeInTheDocument();
    expect(container.querySelector('p')).toHaveAttribute('dir', 'auto');
  });

  it('puts no fill behind the health word, so its color keeps 4.5:1 contrast in both themes', () => {
    const health = { value: 'late' as const, computed: 'late' as const, overridden: false, reason: null, setBy: null };
    render(<HealthPill health={health} status="active" setBy={null} />);
    expect(screen.getByText('Late')).not.toHaveClass('bg-fill');
  });
});

describe('the Glow picture of a person', () => {
  it('uses one color for both lights (owner, 2026-10-01)', async () => {
    const { glowOf } = await import('./Avatar');
    for (const id of ['usr_001', 'usr_002', 'usr_005', 'usr_010']) {
      const hues = new Set([...glowOf(id).matchAll(/--p-(\w+)-fg/g)].map((match) => match[1]));
      expect(hues.size).toBe(1);
    }
  });
});
