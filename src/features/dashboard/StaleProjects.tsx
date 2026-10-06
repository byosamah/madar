import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ProjectSign } from '../../components/ProjectSign';
import { ProjectTile } from '../../components/ProjectTile';
import type { DashboardData } from './Tiles';

/**
 * The paused projects that waited longer than the office allows (colleague comment 16). They show whatever the status filter
 * says, because a stale project is a paused one and the default filter shows active projects only. The people filters still apply.
 */
export function StaleProjects({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const { stale } = view.attention;
  if (stale.length === 0) return null;
  return (
    <section aria-labelledby="dash-stale" className="panel flex flex-col gap-1 p-5">
      <h2 id="dash-stale" className="flex items-center gap-2 pb-1 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2">
        {t('dashboard.stale.title')}
        <span className="tabular rounded-full bg-fill px-2 text-caption font-semibold text-ink-2">{stale.length}</span>
      </h2>
      <ul className="hairline flex flex-col">
        {stale.map((row) => (
          <li key={row.project.id}>
            <Link to={`/projects/${row.project.id}`} className="pressable flex min-h-14 items-center gap-3 py-2 hover:bg-fill/50">
              <ProjectTile id={row.project.id} mark={row.project.mark} size={32} />
              {/* The name never cuts to "...". The text and the sign share one box that wraps: on a wide card the sign stays at
                  the end, and when the name needs the room (a phone) the sign moves to the next line (owner, 2026-10-06). The
                  text starts from its own width (flex-auto, not flex-1), so the box can see that the name needs the room. */}
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-auto">
                  <bdi className="block break-words text-subheadline font-semibold text-ink">{row.project.name}</bdi>
                  <span className="block text-footnote text-ink-2">{t(`dashboard.stale.${row.kind}`)}</span>
                </span>
                <ProjectSign project={{ status: 'on_hold', pause: { kind: row.kind } }} staleDays={row.days} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
