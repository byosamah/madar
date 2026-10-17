/** The types of guard.js for the node test (scripts/proof/do-tx/guard.test.ts): the Worker itself runs the plain JS. */
export function allowed(request: Request, env: { PROBE_SECRET?: string }): boolean;
