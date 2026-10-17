import type { State } from '../../../../src/api/store';
import { AUTH_USER_INSERT } from '../../../auth/own/rows';
import { resolveActor } from '../../../core/actor';
import type { OfficeSnapshot, Principal } from '../../../core/types';
import { readLiteOffice, setLiteAuthLink } from '../../../data/lite/office';
import { liteLoadWhole, liteWriteState } from '../../../data/lite/whole';
import { Office } from '../../office';
import type { OfficeWho } from '../../who';

/** The office object of the live suites: the production class, with no browser sign-in (the token is the user id) and a few test reads. */
export class TestOffice extends Office {
  protected override principal(who: OfficeWho, office: OfficeSnapshot): Principal {
    // An agent of the MCP suite goes through the real rule (principalOfWho).
    if (who.kind !== 'browser') return super.principal(who, office);
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

  /**
   * An AI app that the person approved in Madar, with a live agent session, as the OAuth steps leave it (the MCP suite). The test
   * signs the agent token itself with the key of the run.
   */
  async agent(ownerId: string): Promise<{ authId: string; clientId: string; sessionId: string }> {
    const { db } = this.parts;
    const user = (await db.tx('read', (q) => readLiteOffice(db, q))).lists.users[ownerId];
    if (!user) throw new Error(`No person ${ownerId} in the test office.`);
    const ids = { authId: crypto.randomUUID(), clientId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
    const now = new Date();
    const until = new Date(now.getTime() + 30 * 24 * 3_600_000).toISOString();
    await db.tx('write', async (q) => {
      await q(AUTH_USER_INSERT, [ids.authId, user.email.toLowerCase(), null, 1, 1, now.toISOString()]);
      await setLiteAuthLink(q, ownerId, ids.authId);
      await q('insert into oauth_clients (id, name, redirect_uris, created_at) values (?1, ?2, ?3, ?4)', [ids.clientId, 'Claude', JSON.stringify(['https://claude.ai/api/mcp/auth_callback']), now.toISOString()]);
      await q('insert into agent_approvals (client_id, owner_user_id, approved_at) values (?1, ?2, ?3)', [ids.clientId, ownerId, now.toISOString()]);
      await q("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at, created_at) values (?1, ?2, ?3, 'oauth', ?4, ?5, ?6)",
        [ids.sessionId, ids.authId, ids.clientId, `h-${ids.sessionId}`, until, now.toISOString()]);
    });
    return ids;
  }

  async exec(text: string, values: unknown[] = []): Promise<void> {
    await this.parts.db.statement('write', text, values);
  }
}
