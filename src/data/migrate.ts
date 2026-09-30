import { STATE_VERSION, type State } from '../api/store';
import { SAMPLE_GENDERS } from './seed';

/** Brings an office saved by an older prototype up to date and keeps the work in it. Null means: build a fresh office. */
export function migrateState(state: State): State | null {
  if (state.version === 1) {
    // Version 2: Arabic verbs agree with a person's gender, so the sample people get theirs.
    for (const user of Object.values(state.users)) {
      const gender = SAMPLE_GENDERS[user.email];
      if (gender && !user.gender) user.gender = gender;
    }
    state.version = 2;
  }
  return state.version === STATE_VERSION ? state : null;
}
