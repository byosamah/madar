import type { State } from '../../../../src/api/store';
import { resolveActor } from '../../../core/actor';
import type { OfficeSnapshot, Principal } from '../../../core/types';
import { liteLoadWhole, liteWriteState } from '../../../data/lite/whole';
import { Office } from '../../office';
import type { OfficeWho } from '../../who';

/** The office object of the live suites: the production class, with no sign-in (the token is the user id) and a few test reads. */
export class TestOffice extends Office {
  protected override principal(who: OfficeWho, office: OfficeSnapshot): Principal {
    const principal = { userId: who.authUserId };
    resolveActor(office, principal);
    return principal;
  }

  async seed(state: State): Promise<void> {
    await this.parts.db.tx('write', (q) => liteWriteState(q, state));
  }

  readBack(): Promise<State> {
    return this.parts.db.tx('read', (q) => liteLoadWhole(q));
  }

  rows(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    return this.parts.db.statement('read', text, values);
  }

  async exec(text: string, values: unknown[] = []): Promise<void> {
    await this.parts.db.statement('write', text, values);
  }
}
