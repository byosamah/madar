import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { ScreenTitle } from '../components/ScreenTitle';

/**
 * What a wrong link or a broken screen shows (spec 11.6): one calm sentence in the person's language and one way Home,
 * in place of the router's English developer page (audit 2026-10-03, SHL-6).
 */
function PageProblem({ missing, framed = false }: { missing: boolean; framed?: boolean }) {
  const { t } = useTranslation();
  const title = missing ? t('routeError.missingTitle') : t('routeError.failedTitle');
  // The page title is the level-1 heading, as on every screen and on the project error state. The card under it does not say
  // the title again (audit 2026-10-03, V-34).
  const state = (
    <>
      <ScreenTitle title={title} />
      <EmptyState
        body={missing ? t('routeError.missing') : t('routeError.failed')}
        action={(
          <Link to="/" className="pressable mt-1 inline-flex min-h-11 items-center rounded-full bg-fill px-4 text-subheadline font-semibold text-ink">
            {t('routeError.home')}
          </Link>
        )}
      />
    </>
  );
  // Outside the shell (the shell itself broke) the page gives the state its own margins.
  return framed ? <main className="mx-auto w-full max-w-6xl px-4 pt-6 text-ink sm:px-8 sm:pt-24">{state}</main> : state;
}

/** A link that matches no screen. It shows inside the shell, so the tabs stay. */
export function NotFound() {
  return <PageProblem missing />;
}

/** The error page of a route: a screen that broke while it drew or loaded. */
export function RouteError({ framed = false }: { framed?: boolean }) {
  const error = useRouteError();
  return <PageProblem missing={isRouteErrorResponse(error) && error.status === 404} framed={framed} />;
}
