import { describe, expect, it } from 'vitest';
import { appRoutes, createAppRouter } from './routes';

const paths = (routes: ReturnType<typeof appRoutes>) => routes.map((route) => route.path ?? '(layout)');

describe('the routes of both builds (plan U2)', () => {
  it('keeps hash links and no sign-in in the prototype build', async () => {
    const router = createAppRouter();
    await router.navigate('/projects');
    expect(window.location.hash).toBe('#/projects');
    router.dispose();
    expect(paths(appRoutes(false))).toEqual(['/dashboard/meeting', '/']);
  });

  it('puts the meeting view and the shell inside the gate in the remote build, beside the public screens', () => {
    const routes = appRoutes(true);
    expect(paths(routes)).toEqual(['/sign-in', '/welcome', '/forgot', '/reset', '/oauth/consent', '(layout)']);
    expect(paths(routes.at(-1)?.children ?? [])).toEqual(['/dashboard/meeting', '/']);
  });
});
