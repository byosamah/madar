import { getI18n } from 'react-i18next';
import { useLang } from '../app/lang';
import { useMyState, usePersonState } from '../app/live/hooks';
import type { PersonState } from '../app/live/types';
import { usePersonName } from '../app/personName';
import { useRuntime } from '../app/runtime';
import { actorContext } from '../lib/grammar';
import type { UserCard } from '../api/contract/views';
import { Avatar, type AvatarUser } from './Avatar';

type FaceUser = AvatarUser & { active?: boolean; gender?: UserCard['gender'] };

/** The labels already built, by language, state, grammar form and name. A face then makes no t() call (performance audit 2026-10-21, RN-10). */
const labels = new Map<string, string>();
const LABEL_LIMIT = 2000;

function labelOf(lang: string, state: PersonState, context: 'female' | undefined, name: string): string {
  const key = `${lang}|${state}|${context ?? ''}|${name}`;
  const known = labels.get(key);
  if (known !== undefined) return known;
  const i18n = getI18n();
  if (!i18n) return name;
  const label = i18n.t('presence.faceLabel', { name, state: i18n.t(`presence.${state}`, { context }) });
  // A word file that is not loaded yet gives the key back: never keep that text.
  if (label.startsWith('presence.')) return label;
  if (labels.size >= LABEL_LIMIT) labels.clear();
  labels.set(key, label);
  return label;
}

/** The face with its dot and its label, once the state is known. It reads the language with useLang, not useTranslation (RND-8). */
function StateFace({ user, size, state }: { user: FaceUser; size: number; state: PersonState }) {
  const lang = useLang();
  const nameOf = usePersonName();
  const label = labelOf(lang, state, actorContext(user), nameOf(user));
  return <Avatar user={user} size={size} state={state} label={label} />;
}

/** Each face reads the state of one person alone, so a change of another person renders nothing here (chat presence design, Performance). */
function OtherFace({ user, size }: { user: FaceUser; size: number }) {
  return <StateFace user={user} size={size} state={usePersonState(user.id)} />;
}

function MyFace({ user, size }: { user: FaceUser; size: number }) {
  return <StateFace user={user} size={size} state={useMyState()} />;
}

/** The live port, or nothing outside the app frame (a test of one part, the sign-in screens), as the pictures of the Avatar. */
function useLivePort() {
  try {
    return useRuntime().live;
  } catch {
    return undefined;
  }
}

/**
 * The face of a person with the status dot (chat presence design A3 to A6): a green dot for Online, a ring for Away, no dot for Offline,
 * and a label that says the state ("Reem Al-Ghamdi, Online"). An agent and a person who left have no status, so their face stays as it was.
 * A screen with no live port (the sample office without a tab, a test) also keeps the plain face. `mine` is the face of the person on
 * this screen (the person menu): it shows the own state.
 */
export function PersonFace({ user, size, mine = false }: { user: FaceUser; size: number; mine?: boolean }) {
  const live = useLivePort();
  if (!live || user.kind === 'agent' || user.active === false) return <Avatar user={user} size={size} />;
  return mine ? <MyFace user={user} size={size} /> : <OtherFace user={user} size={size} />;
}
