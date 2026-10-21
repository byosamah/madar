import type { OfficeRight, RoleSettings, StoredRight } from '../api/contract/entities';

/** Role settings for the tests of role rights version 2: the Member role without these basic switches, or with these extra ones. */
export const without = (...ids: OfficeRight[]): RoleSettings => ({ off: { member: ids } });
export const withExtra = (...ids: StoredRight[]): RoleSettings => ({ rights: { member: ids } });
export const both = (offIds: OfficeRight[], extraIds: StoredRight[]): RoleSettings => ({ off: { member: offIds }, rights: { member: extraIds } });
