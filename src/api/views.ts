import type { User } from './contract/entities';
import type { UserCard } from './contract/views';
import type { State } from './store';

export function userCard(user: User): UserCard {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl, kind: user.kind, discipline: user.discipline };
}

export function cardOf(state: State, userId: string): UserCard {
  const user = state.users[userId];
  return user ? userCard(user) : { id: userId, name: '?', avatarUrl: null, kind: 'human', discipline: '' };
}
