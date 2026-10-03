import { alwaysSignedIn, type AuthPort } from '../../app/auth';
import { useRuntime } from '../../app/runtime';

const ALWAYS = alwaysSignedIn();

/** The sign-in port of this runtime. The prototype has none, so it is always signed in. */
export function useAuth(): AuthPort {
  return useRuntime().auth ?? ALWAYS;
}
