import { Hono } from 'hono';
import { depsFrom, serverEnvFrom, type ServerEnv } from '../core/deps';
import type { Deps } from '../core/ports';
import { apiApp } from '../http/app';
import { checkHealth, pgHealthClient } from '../http/health';
import { jobsApp } from '../jobs/app';
import { mcpApp } from '../mcp/app';
import type { Started } from './start';

/**
 * The three apps of the server, read from the environment once for each isolate. Each Supabase function mounts one app
 * under its own name; the Workers entry mounts all three under the same paths (plan 2b, point 2).
 */

export type AppName = 'api' | 'mcp' | 'jobs';

function appOf(name: AppName, deps: Deps, values: ServerEnv): Hono {
  if (name === 'mcp') return mcpApp(deps);
  if (name === 'jobs') return jobsApp(deps);
  const health = () => checkHealth({ connect: pgHealthClient(values.database.writeUrl, values.database.ca), region: values.config.region, log: deps.log });
  return apiApp(deps, { health });
}

/** The apps named here, each mounted at /<name>, on one Hono app. */
export function startApps(names: AppName[]): Started {
  const values = serverEnvFrom();
  const deps = depsFrom(values);
  const host = new Hono();
  for (const name of names) host.route(`/${name}`, appOf(name, deps, values));
  host.notFound(() => Response.json({ v: 1, error: { code: 'not_found', message: 'This address does not exist.' } }, { status: 404 }));
  return { fetch: (request) => host.fetch(request), region: values.config.region };
}
