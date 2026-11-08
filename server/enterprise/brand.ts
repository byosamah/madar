import type { Language, Settings } from '../../src/api/contract/entities';
import type { Deps } from '../core/ports';
import type { EnterpriseId } from './ids';

/**
 * The name and the logo of an enterprise as the mails show them (Madar enterprises, design 5.10). They come from the Settings record. A
 * missing name reads as the product name; a missing Arabic name reads as the English name (else the Arabic product name); a missing logo is
 * null. The mail header uses the brand only when the Admin set a name: an enterprise with no name keeps the Madar header.
 */

export type Brand = { name: string; nameAr: string; logo: string | null };
type BrandSettings = Pick<Settings, 'enterpriseName' | 'enterpriseNameAr' | 'enterpriseLogo'>;

export function brandOfSettings(settings: BrandSettings | undefined): Brand {
  const name = settings?.enterpriseName?.trim() || 'Madar';
  return { name, nameAr: settings?.enterpriseNameAr?.trim() || (settings?.enterpriseName?.trim() ? name : 'مدار'), logo: settings?.enterpriseLogo ?? null };
}

/** The Settings record of this office (one row), read with one statement. The doc is JSON text on SQLite and an object on Postgres. */
export async function readBrand(deps: Pick<Deps, 'db'>): Promise<Brand & { named: boolean }> {
  let doc: BrandSettings | undefined;
  try {
    const [row] = await deps.db.statement<{ doc: unknown }>('read', "select doc from settings where id = 'office'");
    doc = typeof row?.doc === 'string' ? (JSON.parse(row.doc) as BrandSettings) : (row?.doc as BrandSettings | undefined);
  } catch {
    // A mail never fails for its header: with no readable Settings row the mail says Madar, as before.
    doc = undefined;
  }
  return { ...brandOfSettings(doc), named: Boolean(doc?.enterpriseName?.trim()) };
}

/** The public address of the logo of an enterprise (the route of server/enterprise/logoRoute.ts). Mail programs load a picture by address. */
export function enterpriseLogoUrl(appUrl: string, ent: EnterpriseId): string {
  return `${appUrl.replace(/\/+$/, '')}/api/enterprise-logo/${ent}`;
}

/** The brand option of a mail template: the name in the language of the mail, and the logo address when there is a logo. */
export type MailBrand = { name: string; logoUrl?: string };

/**
 * The options that a mail caller passes to a template: the app address, and the brand when the enterprise set a name. A caller with no
 * enterprise id (the Postgres path) passes the name only.
 */
export async function mailOptionsOf(deps: Pick<Deps, 'db' | 'config'>, lang: Language): Promise<{ appUrl: string; brand?: MailBrand }> {
  const appUrl = deps.config.appUrl;
  const brand = await readBrand(deps);
  if (!brand.named) return { appUrl };
  const ent = deps.config.ent;
  return { appUrl, brand: { name: lang === 'ar' ? brand.nameAr : brand.name, ...(brand.logo && ent ? { logoUrl: enterpriseLogoUrl(appUrl, ent) } : {}) } };
}
