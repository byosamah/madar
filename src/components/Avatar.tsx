import { AnimatedIcon } from './icons/AnimatedIcon';
import { SparklesIcon } from './icons/animated/sparkles';
import type { UserCard } from '../api/contract/views';
import { usePersonName } from '../app/personName';
import { usePicture } from '../app/pictures';
import { HUES } from '../lib/projectColor';
import { safePicture } from '../lib/picture';

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

const ARABIC_LETTER = /^[؀-ۿ]/;

/**
 * The letters of the initials circle: the first letter of the first two words. For an Arabic name the article "ال" of a family
 * name is left off (فيصل الحربي gives ف and ح), and a zero-width non-joiner keeps the two letters apart, so they do not join
 * into one word (owner item 12, 2026-10-05).
 */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.some((word) => ARABIC_LETTER.test(word))) {
    return words.map((word, i) => (i > 0 && word.startsWith('ال') && word.length > 2 ? word[2] : word[0])).join('‌');
  }
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}

type AvatarUser = Pick<UserCard, 'id' | 'name' | 'avatarUrl' | 'kind'> & { nameAr?: string | null };

/**
 * The picture of a person: the profile picture (owner item 10) when the person has a safe one, else the initials of the name in
 * the screen language. A card carries an https picture only; picture data comes from the office list (app/pictures.tsx).
 */
export function Avatar({ user, size = 32 }: { user: AvatarUser; size?: number }) {
  const nameOf = usePersonName();
  const fromList = usePicture(user.id);
  const name = nameOf(user);
  const box = { width: size, height: size };
  if (user.kind === 'agent') {
    return (
      <span role="img" aria-label={name} style={{ ...box, background: 'var(--p-indigo-bg)', color: 'var(--p-indigo-fg)' }} className="inline-flex shrink-0 items-center justify-center rounded-full">
        <AnimatedIcon icon={SparklesIcon} size={Math.round(size * 0.5)} aria-hidden />
      </span>
    );
  }
  const picture = safePicture(user.avatarUrl) ?? fromList;
  // The picture sits on the glow of the person, so its see-through parts show the glow (owner, fbk_019, 2026-10-18).
  if (picture) {
    return (
      <span style={{ ...box, background: glowOf(user.id) }} className="inline-flex shrink-0 overflow-hidden rounded-full">
        <img src={picture} alt={name} className="h-full w-full object-cover" />
      </span>
    );
  }
  // The "Glow" picture (owner's choice, 2026-10-01): the soft light of the Next for you card, a mix of two project hues
  // made from the person's id, so it never changes and no two people look alike. The letters stay in ink.
  return (
    <span
      role="img"
      aria-label={name}
      style={{ ...box, background: glowOf(user.id), fontSize: Math.round(size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.01em] text-ink ring-1 ring-inset ring-ink/10"
    >
      {initialsOf(name)}
    </span>
  );
}
