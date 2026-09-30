import { z } from 'zod';
import { UserId } from './entities';

export const UserCard = z.object({
  id: UserId,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  kind: z.enum(['human', 'agent']),
  discipline: z.string(),
});
export type UserCard = z.infer<typeof UserCard>;
