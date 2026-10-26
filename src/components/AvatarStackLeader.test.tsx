import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n } from '../i18n';
import { AvatarStack } from './AvatarStack';

// fbk_060 (owner, 2026-10-26): "make the leader of the project more highlighted". The leader picture gets a 2 px ring in the ink color
// with a 2 px gap in the surface color inside it. The first team picture sits a little further away. All pictures sit on one line.
beforeEach(() => {
  initI18n('en');
});

const person = (id: string, name: string) => ({ id, name, avatarUrl: null, kind: 'human' as const, discipline: 'Architect' });
const leader = person('usr_002', 'Faisal Al-Harbi');
const team = [person('usr_005', 'Sara A'), person('usr_006', 'Yousef S'), person('usr_007', 'Lina M')];

describe('the leader of an avatar stack', () => {
  it('has a 2 px ink ring and a 2 px surface gap, and never the navy or the red', () => {
    render(<AvatarStack leader={leader} team={team} size={26} leaderSize={34} />);
    const [first, second] = screen.getAllByRole('img');
    const ring = first.closest('[data-leader]') as HTMLElement;
    expect(ring).not.toBeNull();
    expect(ring).toHaveClass('ring-2', 'ring-ink', 'p-0.5', 'bg-card', 'rounded-full');
    expect(ring.className.split(/\s+/).filter((name) => name.startsWith('ring'))).toEqual(['ring-2', 'ring-ink']);
    expect(first).toHaveStyle({ width: '34px' });
    // A team picture has the surface ring only, never the ink ring.
    expect(second.closest('[data-leader]')).toBeNull();
    expect(second.parentElement).toHaveClass('ring-card');
    expect(second.parentElement).not.toHaveClass('ring-ink');
  });

  it('keeps the box of the leader as big as the picture, so a row does not grow', () => {
    render(<AvatarStack leader={leader} team={team} size={26} leaderSize={34} />);
    const ring = screen.getAllByRole('img')[0].closest('[data-leader]') as HTMLElement;
    expect(ring).toHaveClass('-m-0.5');
  });

  it('puts the first team picture a little away from the leader, and the others overlap by 4 px as before', () => {
    render(<AvatarStack leader={leader} team={team} size={26} leaderSize={34} />);
    const pictures = screen.getAllByRole('img');
    expect(pictures[1].parentElement).toHaveClass('ms-2');
    expect(pictures[1].parentElement).not.toHaveClass('-ms-1');
    expect(pictures[2].parentElement).toHaveClass('-ms-1');
  });

  it('puts all pictures on one middle line', () => {
    const { container } = render(<AvatarStack leader={leader} team={team} size={26} leaderSize={34} />);
    expect(container.firstElementChild).toHaveClass('flex', 'items-center');
  });

  it('names the leader to a screen reader and on hover, and the others by their names', () => {
    render(<AvatarStack leader={leader} team={team} size={26} leaderSize={34} />);
    const pictures = screen.getAllByRole('img');
    expect(pictures[0]).toHaveAccessibleName('Leader: Faisal Al-Harbi');
    expect(pictures[1]).toHaveAccessibleName('Sara A');
  });

  it('draws no ring when there is no leader (a team list)', () => {
    const { container } = render(<AvatarStack leader={null} team={team} size={28} />);
    expect(container.querySelector('[data-leader]')).toBeNull();
    expect(screen.getAllByRole('img')[0].parentElement).toHaveClass('ring-card');
    expect(screen.getAllByRole('img')[0]).toHaveAccessibleName('Sara A');
  });

  it('keeps the "+N" circle and the one-hidden-person rule', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((letter, i) => person(`usr_01${i}`, `Person ${letter}`));
    render(<AvatarStack leader={leader} team={many} max={2} size={26} leaderSize={34} />);
    expect(screen.getByText('+3')).toBeInTheDocument();
    const four = many.slice(0, 3);
    render(<AvatarStack leader={leader} team={four} max={2} size={26} leaderSize={34} />);
    expect(screen.queryByText('+1')).toBeNull();
  });
});
