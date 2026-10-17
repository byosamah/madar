import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { authAdminPort } from '../auth/admin';
import { verifyBcrypt } from '../auth/own/bcrypt';
import { SIGNIN_EXPORT_SQL, type SigninExportRow } from '../auth/own/import';
import { localStack } from './authStack';
import { LOCAL_DB_URL } from './migrate';

/** Owner decision 4: the export reads the bcrypt hash that Supabase Auth made, and the own check accepts it. Local stack only. */
describe('the export of the sign-in rows from Supabase Auth', () => {
  it('gives the bcrypt hash of Auth with its marks, and verifyBcrypt accepts it', async () => {
    const stack = localStack();
    const admin = authAdminPort({ supabaseUrl: stack.apiUrl, secretKey: stack.secretKey });
    const email = `export-${Date.now()}@madar.test`;
    const { authUserId } = await admin.createUser(email, 'a copied password');
    const client = new pg.Client({ connectionString: process.env.MADAR_LOCAL_DB_URL ?? LOCAL_DB_URL });
    await client.connect();
    try {
      const mine = (await client.query<SigninExportRow>(SIGNIN_EXPORT_SQL)).rows.find((one) => one.id === authUserId);
      expect(mine).toMatchObject({ email, email_confirmed: true, banned: false, password_set: true, user_id: null });
      expect(mine?.password_hash).toMatch(/^\$2a\$10\$/);
      expect(verifyBcrypt('a copied password', String(mine?.password_hash))).toBe(true);
    } finally {
      await client.query('delete from auth.users where id = $1', [authUserId]);
      await client.end();
    }
  });
});
