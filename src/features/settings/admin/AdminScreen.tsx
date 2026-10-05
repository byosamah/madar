import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { useCall } from '../../../app/runtime';
import { useIsPhone } from '../../../app/useIsPhone';
import { EmptyState } from '../../../components/EmptyState';
import { ScreenTitle } from '../../../components/ScreenTitle';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../../components/icons/animated/chevron-left';
import { ChevronRightIcon } from '../../../components/icons/animated/chevron-right';
import { spring } from '../../../design/motion';
import { groupsFor, sectionsFor, type AdminSection } from './sections';

const linkOf = (section: AdminSection) => `/admin/${section.id}`;

/**
 * The Admin page (owner, 2026-10-01): the people of the office and the office settings, apart from personal Settings.
 * The page grows, so its sections sit in a grouped side list and one section shows at a time (owner, 2026-10-05, item 4).
 * Each section has its own link, /admin/<id>. The sections and their roles are in sections.ts. The API refuses the calls of a
 * section for every other role too.
 * On a desk the list sits at the start side and /admin opens the first section. A phone shows only the list at /admin, a row
 * opens its section, and Back returns to the list.
 */
export function AdminScreen() {
  const { t } = useTranslation();
  const { section: openId } = useParams();
  const phone = useIsPhone();
  const session = useCall('session.get', {});
  if (!session.data) return null;
  const sections = sectionsFor(session.data.authority.systemRole);
  // An unknown section, or a section that the role may not see, goes back to /admin.
  const open = sections.find((section) => section.id === openId);
  if (openId !== undefined && !open) return <Navigate to="/admin" replace />;
  if (sections.length === 0) {
    return (
      <>
        <ScreenTitle title={t('admin.title')} />
        <EmptyState title={t('admin.title')} body={t('admin.onlyAdmin')} />
      </>
    );
  }
  if (!open && !phone) return <Navigate to={linkOf(sections[0])} replace />;
  const Open = open?.Component;
  // One tree for both widths: a phone that turns sideways passes 640 px, and the open section keeps its place and its state.
  return (
    <>
      {/* A phone section shows its own title once. The page title stays for screen readers. */}
      <div className={phone && open ? 'sr-only' : undefined}>
        <ScreenTitle title={t('admin.title')}>{t('admin.subtitle')}</ScreenTitle>
      </div>
      <div className={phone ? 'flex flex-col' : 'grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8'}>
        {(!phone || !open) && <SectionList sections={sections} openId={phone ? undefined : open?.id} phone={phone} />}
        {Open && (
          <div className="flex min-w-0 flex-col gap-2">
            {phone && (
              <Link to="/admin" className="pressable -ms-2 inline-flex min-h-11 items-center gap-0.5 self-start rounded-full pe-3 ps-1 text-subheadline font-semibold text-link">
                <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
                {t('admin.title')}
              </Link>
            )}
            <Open />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The grouped list of the sections. On a desk it stays in view at the start side, and the open row has the look of the open tab.
 * On a phone each group is a panel of rows that open their section.
 */
function SectionList({ sections, openId, phone = false }: { sections: AdminSection[]; openId?: string; phone?: boolean }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('adminNav.label')} className={phone ? 'flex flex-col gap-5' : 'sticky top-24 flex flex-col gap-5'}>
      {groupsFor(sections).map(({ group, sections: rows }) => (
        <div key={group} className="flex flex-col gap-1.5">
          {/* The group word is quiet. The list carries the same word as its name for screen readers. */}
          <p aria-hidden className={`text-footnote font-medium text-ink-2 ${phone ? 'px-5' : 'px-4'}`}>{t(`adminNav.groups.${group}`)}</p>
          <ul aria-label={t(`adminNav.groups.${group}`)} className={phone ? 'panel hairline overflow-hidden' : 'flex flex-col gap-0.5'}>
            {rows.map((section) => (
              <li key={section.id}>
                {phone ? <PhoneRow section={section} /> : <DeskRow section={section} open={section.id === openId} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function DeskRow({ section, open }: { section: AdminSection; open: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to={linkOf(section)}
      aria-current={open ? 'page' : undefined}
      className={`pressable relative isolate flex min-h-11 items-center rounded-full px-4 text-subheadline font-semibold ${open ? 'text-[var(--on-sig)]' : 'text-ink hover:bg-fill'}`}
    >
      {/* The open row carries the signature, as the open tab of the tab pill does, and it glides to the next open row. */}
      {open && <motion.span layoutId="admin-open-row" transition={spring.standard} className="signature absolute inset-0 -z-10 rounded-full" />}
      <span className="min-w-0 truncate">{t(section.titleKey)}</span>
    </Link>
  );
}

function PhoneRow({ section }: { section: AdminSection }) {
  const { t } = useTranslation();
  return (
    <Link to={linkOf(section)} className="pressable flex min-h-14 items-center gap-3 px-5 hover:bg-fill/50">
      <span className="min-w-0 flex-1 text-subheadline font-medium text-ink">{t(section.titleKey)}</span>
      <AnimatedIcon icon={ChevronRightIcon} size={18} className="text-ink-2 rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}
