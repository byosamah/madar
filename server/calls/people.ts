import { notBuiltAsync } from '../core/notBuilt';
import type { ServerCall } from '../core/types';

/** Track P replaces these stubs (plan 5.1). */
export const usersInvites: ServerCall<'users.invites'> = () => notBuiltAsync('users.invites');
export const usersResendInvite: ServerCall<'users.resendInvite'> = () => notBuiltAsync('users.resendInvite');
