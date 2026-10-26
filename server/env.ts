/**
 * One way to read the environment on every host: Supabase Edge Functions (Deno), Cloudflare Workers and Node (tests and scripts).
 * The Workers entry passes its bindings with setEnvSource, because a Worker gets its values with each request.
 * An empty value counts as missing.
 */
export type EnvSource = Record<string, unknown>;

let source: EnvSource | undefined;

export function setEnvSource(next: EnvSource | undefined): void {
  source = next;
}

type DenoLike = { env: { get(name: string): string | undefined } };

function present(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function env(name: string): string | undefined {
  const fromSource = present(source?.[name]);
  if (fromSource !== undefined) return fromSource;
  const deno = (globalThis as { Deno?: DenoLike }).Deno;
  const fromDeno = deno ? present(deno.env.get(name)) : undefined;
  if (fromDeno !== undefined) return fromDeno;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return present(proc?.env?.[name]);
}

/** The value, or an error that names the missing value. The error never holds a value. */
export function requireEnv(name: string): string {
  const value = env(name);
  if (value === undefined) throw new Error(`${name} is not set.`);
  return value;
}

/**
 * The names of all values that the host holds, for a family of secrets whose names follow a pattern (the Daftra accounts,
 * server/daftra/config.ts). Only names: never a value. A host that cannot list its values gives the names it can.
 */
export function envNames(): string[] {
  const names = new Set<string>();
  for (const [name, value] of Object.entries(source ?? {})) if (present(value) !== undefined) names.add(name);
  const deno = (globalThis as { Deno?: { env?: { toObject?: () => Record<string, string> } } }).Deno;
  try {
    for (const name of Object.keys(deno?.env?.toObject?.() ?? {})) names.add(name);
  } catch {
    // The host refuses to list the environment: the names of the source are enough.
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  for (const [name, value] of Object.entries(proc?.env ?? {})) if (present(value) !== undefined) names.add(name);
  return [...names];
}

env.names = envNames;
