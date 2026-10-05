import { TEST_REF } from '../../scripts/seed-test-office';

/**
 * The projects that the browser checks talk to outside the page (task X2): the database with mail_outbox, the Supabase project
 * of the agent flow, and the app that the mail links must open. Each one is madar-test or the local stack, never another project.
 * A run on the test deployment (MADAR_DEPLOY_URL) must name each one: a missing value never falls back to the local stack.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
/** The test copy on Pages: its /mcp forwards to the mcp function of madar-test only. */
const TEST_MCP_HOST = 'preview.madar-46r.pages.dev';
const PRODUCTION_REF = 'oprkvdjudjxxhvodkzgs';
const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

type Env = Record<string, string | undefined>;

function given(env: Env, name: string, local: string): string {
  const value = env[name];
  if (value) return value;
  if (env.MADAR_DEPLOY_URL) throw new Error(`${name} is missing for the test deployment: set it to the value of madar-test.`);
  return local;
}

export type DatabaseTarget = { url: string; tls: boolean };

/** The database of mail_outbox: the session pooler of madar-test as postgres, or the database of the local stack. */
export function databaseTarget(env: Env): DatabaseTarget {
  const url = given(env, 'MADAR_E2E_DATABASE_URL', LOCAL_DATABASE_URL);
  // pg reads ssl, sslmode, sslrootcert, sslcert, sslkey and uselibpqcompat from the URL, and the result replaces the ssl options
  // that carry the CA ("sslmode=no-verify" turns the certificate check off). So the URL carries no TLS setting at all.
  if (/[?&](ssl\w*|uselibpqcompat)=/i.test(url)) {
    throw new Error('MADAR_E2E_DATABASE_URL must not carry a TLS setting such as ssl or sslmode: the specs pass the root certificate as ca (plan 4.5).');
  }
  const { hostname, username } = new URL(url);
  if (url.includes(PRODUCTION_REF)) throw new Error('The browser checks never read the production database.');
  const local = LOCAL_HOSTS.has(hostname);
  if (!local && ![hostname, username].some((part) => part.includes(TEST_REF))) {
    throw new Error(`The browser checks read only the database of madar-test (${TEST_REF}) or of the local stack, not ${hostname}.`);
  }
  return { url, tls: !local };
}

export type SupabaseTarget = { supabaseUrl: string; mcpUrl: string };

/** The Supabase project of the agent flow (Auth and the MCP function): madar-test or the local stack. */
export function supabaseTarget(env: Env): SupabaseTarget {
  const supabaseUrl = given(env, 'MADAR_E2E_SUPABASE_URL', LOCAL_SUPABASE_URL).replace(/\/+$/, '');
  const mcpUrl = env.MADAR_E2E_MCP_URL ?? `${supabaseUrl}/functions/v1/mcp`;
  for (const [name, url] of [['MADAR_E2E_SUPABASE_URL', supabaseUrl], ['MADAR_E2E_MCP_URL', mcpUrl]] as const) {
    const { hostname } = new URL(url);
    // The MCP URL may also be the short address of the test copy, which forwards to madar-test (server/http/pagesMcpProxy.ts).
    const testCopy = name === 'MADAR_E2E_MCP_URL' && hostname === TEST_MCP_HOST;
    if (!LOCAL_HOSTS.has(hostname) && hostname !== `${TEST_REF}.supabase.co` && !testCopy) {
      throw new Error(`${name} must name madar-test (${TEST_REF}.supabase.co) or the local stack, not ${hostname}.`);
    }
  }
  return { supabaseUrl, mcpUrl };
}

/** The origin that the invitation and reset links must open: MADAR_E2E_APP_URL (the APP_URL of the deployment), else the run's. */
export function appOrigin(env: Env, baseURL: string | undefined): string {
  const url = env.MADAR_E2E_APP_URL ?? baseURL;
  if (!url) throw new Error('MADAR_E2E_APP_URL is missing and the run has no baseURL.');
  return new URL(url).origin;
}
