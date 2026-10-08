import { Hono } from 'hono';
import { depsFrom, serverEnvFrom, type ServerEnv } from '../core/deps';
import type { Deps } from '../core/ports';
import type { Started } from './start';

/**
 * The host of the server apps, read from the environment once for each isolate. Each Supabase function mounts one app under
 * its own name; the Workers entry mounts all three under the same paths (plan 2b, point 2).
 *
 * This file imports no app. Each app comes from its own mount file (api.ts, mcp.ts, jobs.ts), and each Supabase entry imports
 * only its own mount, so each function bundle holds only its own app (review of E: the api bundle never carries the MCP SDK).
 */

export type AppName = 'api' | 'mcp' | 'jobs';
export type AppMount = { name: AppName; app: (deps: Deps, values: ServerEnv) => Hono };

/** The apps of the mounts, each at /<name>, on one Hono app. */
export function hostOf(mounts: AppMount[], deps: Deps, values: ServerEnv): Hono {
  const host = new Hono();
  for (const mount of mounts) host.route(`/${mount.name}`, mount.app(deps, values));
  host.notFound(() => Response.json({ v: 1, error: { code: 'not_found', message: 'This address does not exist.' } }, { status: 404 }));
  return host;
}

/**
 * The mounted apps with the Deps of the isolate: the two pools live as long as the isolate (Supabase Edge Functions). warm: the
 * work that a new worker starts before its first request (start.ts).
 */
export function startApps(mounts: AppMount[], o: { warm?: (deps: Deps) => void } = {}): Started {
  const values = serverEnvFrom();
  const deps = depsFrom(values);
  const host = hostOf(mounts, deps, values);
  const warm = o.warm;
  return { fetch: (request) => host.fetch(request), region: values.config.region, ...(warm ? { warm: () => warm(deps) } : {}) };
}
