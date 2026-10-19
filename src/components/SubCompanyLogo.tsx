import { useLang } from '../app/lang';
import { useSubCompany } from '../app/subCompanies';
import { safePicture } from '../lib/picture';

/** The plate behind a logo picture. It is the same white in the light and in the dark theme. */
export const LOGO_PLATE = '#FFFFFF';

/**
 * The logo of a sub-company in a circle, with the whole picture inside it (fbk_007). With no logo, the first letter of its name
 * shows on the fill color. It shows nothing while the office list has no such sub-company. The name is the label for a screen
 * reader, so the logo adds no words of its own.
 */
export function SubCompanyLogo({ subCompanyId, size }: { subCompanyId: string; size: number }) {
  const lang = useLang();
  const sub = useSubCompany(subCompanyId);
  if (!sub) return null;
  const name = lang === 'ar' ? sub.nameAr : sub.name;
  const logo = safePicture(sub.logo);
  const box = { width: size, height: size };
  if (logo) {
    return (
      // Logos are made for white paper. The plate stays white in both themes, so a dark mark on a see-through ground shows in dark
      // mode too (PRJ-10). The letter below keeps the fill token.
      <span style={{ ...box, background: LOGO_PLATE }} className="inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-ink/10">
        <img src={logo} alt={name} data-sub-company-logo="" className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      style={{ ...box, fontSize: Math.round(size * 0.42) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-fill font-bold text-ink ring-1 ring-inset ring-ink/10"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
