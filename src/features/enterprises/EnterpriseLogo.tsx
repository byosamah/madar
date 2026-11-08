import type { EnterpriseView } from '../../api/contract/platform';
import { LOGO_PLATE } from '../../lib/logoPlate';

/** The first letter of a name, in the case of its language. It is empty for an empty name. */
export const firstLetter = (name: string): string => (Array.from(name.trim())[0] ?? '').toUpperCase();

/**
 * The logo of an enterprise in a round plate. With no logo, the first letter of the name shows on the fill color, as the logo of a
 * sub-company does. The name stands next to it on the page, so the circle is hidden from a screen reader.
 */
export function EnterpriseLogo({ logo, name, size }: { logo: EnterpriseView['logo']; name: string; size: number }) {
  const box = { width: size, height: size };
  if (logo) {
    return (
      <span style={{ ...box, background: LOGO_PLATE }} className="flex shrink-0 items-center justify-center overflow-hidden rounded-full">
        <img src={logo} alt="" className="size-full object-contain" />
      </span>
    );
  }
  return (
    <span aria-hidden style={{ ...box, fontSize: Math.round(size * 0.42) }} className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill font-bold text-ink">
      {firstLetter(name)}
    </span>
  );
}
