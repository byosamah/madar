import { Sparkles } from 'lucide-react';
import type { UserCard } from '../api/contract/views';
import { projectHue } from '../lib/projectColor';

// Darker tints so white initials pass the 4.5:1 contrast rule. Only the cover panel of a project without a picture uses them now.
const TINTS = ['#C93400', '#1E7A34', '#0040DD', '#8944AB', '#D30F45', '#0071A4', '#B25000', '#6C6C70'];

export function tintOf(id: string): string {
  let sum = 0;
  for (const ch of id) sum += ch.charCodeAt(0);
  return TINTS[sum % TINTS.length];
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

export function Avatar({ user, size = 32 }: { user: Pick<UserCard, 'id' | 'name' | 'avatarUrl' | 'kind'>; size?: number }) {
  const box = { width: size, height: size };
  if (user.kind === 'agent') {
    return (
      <span role="img" aria-label={user.name} style={{ ...box, background: 'var(--p-indigo-bg)', color: 'var(--p-indigo-fg)' }} className="inline-flex shrink-0 items-center justify-center rounded-full">
        <Sparkles size={Math.round(size * 0.5)} aria-hidden />
      </span>
    );
  }
  if (user.avatarUrl) return <img src={user.avatarUrl} alt={user.name} style={box} className="shrink-0 rounded-full object-cover" />;
  // A person's picture uses the same soft hues as the project tiles (owner's request): a pale tint with deep letters.
  const hue = projectHue(user.id);
  return (
    <span
      role="img"
      aria-label={user.name}
      style={{ ...box, background: `var(--p-${hue}-bg)`, color: `var(--p-${hue}-fg)`, fontSize: Math.round(size * 0.38) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
    >
      {initialsOf(user.name)}
    </span>
  );
}
