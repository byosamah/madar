import { AnimatedIcon } from './icons/AnimatedIcon';
import { SparklesIcon } from './icons/animated/sparkles';
import type { UserCard } from '../api/contract/views';
import { HUES } from '../lib/projectColor';

// Darker tints so white initials pass the 4.5:1 contrast rule. Only the cover panel of a project without a picture uses them now.
const TINTS = ['#C93400', '#1E7A34', '#0040DD', '#8944AB', '#D30F45', '#0071A4', '#B25000', '#6C6C70'];

export function tintOf(id: string): string {
  let sum = 0;
  for (const ch of id) sum += ch.charCodeAt(0);
  return TINTS[sum % TINTS.length];
}

function hashOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

/** Two soft lights in two project hues, placed from the id. The strength comes from --avatar-glow, which is lower in dark mode. */
export function glowOf(id: string): string {
  const n = hashOf(id);
  const one = HUES[n % HUES.length];
  const two = HUES[(n >>> 3) % HUES.length];
  const light = (hue: string) => `color-mix(in srgb, var(--p-${hue}-fg) var(--avatar-glow), transparent)`;
  return [
    `radial-gradient(75% 75% at ${20 + (n % 20)}% ${15 + ((n >>> 4) % 25)}%, ${light(one)} 0%, transparent 100%)`,
    `radial-gradient(70% 70% at ${85 - ((n >>> 2) % 20)}% ${90 - ((n >>> 6) % 25)}%, ${light(two)} 0%, transparent 100%)`,
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
