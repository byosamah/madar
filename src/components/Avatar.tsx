import { AnimatedIcon } from './icons/AnimatedIcon';
import { SparklesIcon } from './icons/animated/sparkles';
import type { UserCard } from '../api/contract/views';
import { HUES } from '../lib/projectColor';

function hashOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

/**
 * One color per person (owner, 2026-10-01: "one color instead of two"): two soft lights of the same project hue,
 * placed from the id, so the picture keeps its depth. The strength comes from --avatar-glow, lower in dark mode.
 */
export function glowOf(id: string): string {
  const n = hashOf(id);
  const hue = HUES[n % HUES.length];
  const light = (strength: string) => `color-mix(in srgb, var(--p-${hue}-fg) ${strength}, transparent)`;
  return [
    `radial-gradient(75% 75% at ${20 + (n % 20)}% ${15 + ((n >>> 4) % 25)}%, ${light('var(--avatar-glow)')} 0%, transparent 100%)`,
    `radial-gradient(70% 70% at ${85 - ((n >>> 2) % 20)}% ${90 - ((n >>> 6) % 25)}%, ${light('calc(var(--avatar-glow) * 0.6)')} 0%, transparent 100%)`,
    'var(--c-panel)',
  ].join(', ');
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

export function Avatar({ user, size = 32 }: { user: Pick<UserCard, 'id' | 'name' | 'avatarUrl' | 'kind'>; size?: number }) {
  const box = { width: size, height: size };
  if (user.kind === 'agent') {
    return (
      <span role="img" aria-label={user.name} style={{ ...box, background: 'var(--p-indigo-bg)', color: 'var(--p-indigo-fg)' }} className="inline-flex shrink-0 items-center justify-center rounded-full">
        <AnimatedIcon icon={SparklesIcon} size={Math.round(size * 0.5)} aria-hidden />
      </span>
    );
  }
  if (user.avatarUrl) return <img src={user.avatarUrl} alt={user.name} style={box} className="shrink-0 rounded-full object-cover" />;
  // The "Glow" picture (owner's choice, 2026-10-01): the soft light of the Next for you card, a mix of two project hues
  // made from the person's id, so it never changes and no two people look alike. The letters stay in ink.
  return (
    <span
      role="img"
      aria-label={user.name}
      style={{ ...box, background: glowOf(user.id), fontSize: Math.round(size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.01em] text-ink ring-1 ring-inset ring-ink/10"
    >
      {initialsOf(user.name)}
    </span>
  );
}
