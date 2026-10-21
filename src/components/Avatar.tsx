import { AnimatedIcon } from './icons/AnimatedIcon';
import { SparklesIcon } from './icons/animated/sparkles';
import type { UserCard } from '../api/contract/views';
import { usePersonName } from '../app/personName';
import { usePicture } from '../app/pictures';
import { personLights, screenGlow } from '../lib/glow';
import { safePicture } from '../lib/picture';
import type { PersonState } from '../app/live/types';

/**
 * One color per person (owner, 2026-10-01: "one color instead of two"): two soft lights of the same project hue,
 * placed from the id, so the picture keeps its depth. The strength comes from --avatar-glow, lower in dark mode.
 */
export function glowOf(id: string): string {
  return screenGlow(personLights(id));
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

export type AvatarUser = Pick<UserCard, 'id' | 'name' | 'avatarUrl' | 'kind'> & { nameAr?: string | null };

/** The visible size of the status dot for a face of this size (chat presence design A3). The ring of the panel color comes on top. */
function dotSizeOf(size: number): number {
  return size >= 40 ? 12 : size >= 36 ? 11 : size >= 28 ? 9 : 8;
}

/**
 * The status dot on the end-bottom corner of a face (chat presence design A3, dot look A like Slack). Online is a filled green dot.
 * Away is the panel color with an inner ring of the Ink 2 token, so the state does not depend on color alone. Offline has no dot. The
 * dot is hidden from a screen reader, because the label of the face says the state. It never moves.
 */
function StatusDot({ state, size }: { state: 'online' | 'away'; size: number }) {
  const dot = dotSizeOf(size);
  return (
    <span
      aria-hidden
      data-presence={state}
      style={{ width: dot, height: dot }}
      className={`pointer-events-none absolute -bottom-px -end-px box-content rounded-full border-2 border-panel ${state === 'online' ? 'bg-green' : 'bg-panel ring-2 ring-inset ring-ink-2'}`}
    />
  );
}

/**
 * The picture of a person: the profile picture (owner item 10) when the person has a safe one, else the initials of the name in
 * the screen language. A card carries an https picture only; picture data comes from the office list (app/pictures.tsx).
 * `state` adds the status dot (PersonFace gives it), and `label` replaces the name in the label of the picture, so a screen reader
 * hears the state too.
 */
export function Avatar({ user, size = 32, state, label }: { user: AvatarUser; size?: number; state?: PersonState; label?: string }) {
  const face = <Picture user={user} size={size} label={label} />;
  if (state !== 'online' && state !== 'away') return face;
  return (
    <span className="relative inline-flex shrink-0">
      {face}
      <StatusDot state={state} size={size} />
    </span>
  );
}

function Picture({ user, size, label }: { user: AvatarUser; size: number; label?: string }) {
  const nameOf = usePersonName();
  const fromList = usePicture(user.id);
  const name = nameOf(user);
  const heard = label ?? name;
  const box = { width: size, height: size };
  if (user.kind === 'agent') {
    return (
      <span role="img" aria-label={heard} style={{ ...box, background: 'var(--p-indigo-bg)', color: 'var(--p-indigo-fg)' }} className="inline-flex shrink-0 items-center justify-center rounded-full">
        <AnimatedIcon icon={SparklesIcon} size={Math.round(size * 0.5)} aria-hidden />
      </span>
    );
  }
  const picture = safePicture(user.avatarUrl) ?? fromList;
  // The picture sits on the glow of the person, so its see-through parts show the glow (owner, fbk_019, 2026-10-18).
  if (picture) {
    return (
      <span style={{ ...box, background: glowOf(user.id) }} className="inline-flex shrink-0 overflow-hidden rounded-full">
        <img src={picture} alt={heard} className="h-full w-full object-cover" />
      </span>
    );
  }
  // The "Glow" picture (owner's choice, 2026-10-01): the soft light of the Next for you card, a mix of two project hues
  // made from the person's id, so it never changes and no two people look alike. The letters stay in ink.
  return (
    <span
      role="img"
      aria-label={heard}
      style={{ ...box, background: glowOf(user.id), fontSize: Math.round(size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.01em] text-ink ring-1 ring-inset ring-ink/10"
    >
      {initialsOf(name)}
    </span>
  );
}
