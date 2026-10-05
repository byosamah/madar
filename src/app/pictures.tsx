import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { safePicture } from '../lib/picture';
import { useCall } from './runtime';

/** The profile picture of each person, by id. Empty outside the app frame (tests of one part, the sign-in screens). */
export const PicturesContext = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * The profile pictures of the office (owner item 10, 2026-10-05). The person cards in lists carry no picture data, so a list
 * of 100 tasks stays small. This reads users.list once (the remote build keeps the answer until a person changes) and gives each
 * Avatar the picture of its person.
 */
export function PicturesProvider({ children }: { children: ReactNode }) {
  // The same query as the people pickers, so it costs no extra load. A person who left shows initials instead.
  const users = useCall('users.list', {});
  const pictures = useMemo(() => new Map((users.data ?? []).flatMap((user) => {
    const picture = safePicture(user.avatarUrl);
    return picture ? [[user.id, picture] as const] : [];
  })), [users.data]);
  return <PicturesContext.Provider value={pictures}>{children}</PicturesContext.Provider>;
}

/** The profile picture of one person from the office list, or null. */
export function usePicture(userId: string): string | null {
  return useContext(PicturesContext).get(userId) ?? null;
}
