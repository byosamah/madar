import type { Page } from '@playwright/test';

/**
 * Links of the browser checks on the test deployment (task X2). The prototype uses hash links (/#/projects); the remote build
 * uses path links (/projects), because email links and the agent consent redirect carry a query string on a real path (plan,
 * section 2, change 16). Every spec names its screen by route ("/projects?tab=tasks") and lets these helpers write the link.
 *
 * MADAR_E2E_TARGET=prototype points the same specs at a prototype build; the default is the remote build.
 */
export type Target = 'remote' | 'prototype';

export const TARGET: Target = process.env.MADAR_E2E_TARGET === 'prototype' ? 'prototype' : 'remote';
export const REMOTE = TARGET === 'remote';
/** True when the run checks a deployment (MADAR_DEPLOY_URL), false on the local stack. */
export const DEPLOYED = Boolean(process.env.MADAR_DEPLOY_URL);

function checked(route: string): string {
  if (!route.startsWith('/')) throw new Error(`A route starts with /: ${route}`);
  if (route.startsWith('/#')) throw new Error(`Name the route without the hash: ${route}`);
  return route;
}

/** The link of a route in the target build. */
export function routeUrl(route: string, target: Target = TARGET): string {
  return target === 'prototype' ? `/#${checked(route)}` : checked(route);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A pattern for expect(page).toHaveURL: the route right after the host (remote) or right after the hash (prototype). With
 * `end`, nothing may follow the route, like the old /#\/dashboard$/.
 */
export function urlPattern(route: string, o: { target?: Target; end?: boolean } = {}): RegExp {
  const target = o.target ?? TARGET;
  const start = target === 'prototype' ? '#' : '^[a-z]+://[^/#]+';
  return new RegExp(`${start}${escape(checked(route))}${o.end ? '$' : ''}`);
}

/** Opens a route in the target build. */
export async function goto(page: Page, route: string): Promise<void> {
  await page.goto(routeUrl(route));
}
