import { describe, expect, it } from 'vitest';
import { renderSigninMail } from '../auth/mail';
import { renderMail } from '../mail/templates';
import { renderConfirmMail } from '../mcp/guard';
import { freshLite } from '../data/lite/testDb';
import { brandOfSettings, enterpriseLogoUrl, mailOptionsOf, readBrand } from './brand';

const APP = 'https://madar.test';

describe('brandOfSettings', () => {
  it('falls back to Madar and the Arabic product name, and to the English name for a missing Arabic name', () => {
    expect(brandOfSettings(undefined)).toEqual({ name: 'Madar', nameAr: 'مدار', logo: null });
    expect(brandOfSettings({})).toEqual({ name: 'Madar', nameAr: 'مدار', logo: null });
    expect(brandOfSettings({ enterpriseName: 'Acme' })).toEqual({ name: 'Acme', nameAr: 'Acme', logo: null });
    expect(brandOfSettings({ enterpriseName: 'Acme', enterpriseNameAr: 'أكمي', enterpriseLogo: 'data:image/png;base64,AAAA' })).toEqual({ name: 'Acme', nameAr: 'أكمي', logo: 'data:image/png;base64,AAAA' });
  });

  it('builds the logo address under the app address', () => expect(enterpriseLogoUrl(`${APP}/`, 'ent_002')).toBe('https://madar.test/api/enterprise-logo/ent_002'));
});

describe('mailOptionsOf', () => {
  async function deps(doc: object | null, ent?: string) {
    const { db, raw } = await freshLite();
    if (doc) raw.exec(`update settings set doc = '${JSON.stringify(doc)}' where id = 'office'`);
    return { db, config: { appUrl: APP, ...(ent ? { ent } : {}) } } as never;
  }

  it('gives the app address only when the enterprise set no name', async () => {
    expect(await mailOptionsOf(await deps(null, 'ent_002'), 'en')).toEqual({ appUrl: APP });
  });

  it('gives the name in the language of the mail, and the logo address when there is a logo and an enterprise id', async () => {
    const doc = { enterpriseName: 'Acme', enterpriseNameAr: 'أكمي', enterpriseLogo: 'data:image/png;base64,AAAA' };
    expect(await mailOptionsOf(await deps(doc, 'ent_002'), 'en')).toEqual({ appUrl: APP, brand: { name: 'Acme', logoUrl: `${APP}/api/enterprise-logo/ent_002` } });
    expect((await mailOptionsOf(await deps(doc, 'ent_002'), 'ar')).brand?.name).toBe('أكمي');
    // The Postgres path (no enterprise id) reads nothing and keeps the Madar header.
    expect(await mailOptionsOf(await deps(doc), 'en')).toEqual({ appUrl: APP });
  });

  it('reads the Settings row', async () => {
    const d = await deps({ enterpriseName: 'Acme' }, 'ent_002');
    expect(await readBrand(d)).toMatchObject({ name: 'Acme', named: true });
  });
});

describe('the mail header', () => {
  const link = 'https://madar.test/welcome#x';
  const brand = { name: 'Acme Co', logoUrl: `${APP}/api/enterprise-logo/ent_002` };

  it('shows the enterprise name and logo in the invite and reset mails, in English and Arabic', () => {
    for (const kind of ['invite', 'reset'] as const) {
      const en = renderSigninMail(kind, 'en', { name: 'Sara', link }, undefined, { appUrl: APP, brand });
      expect(en.html).toContain('Acme Co');
      expect(en.html).toContain(brand.logoUrl);
      expect(en.html).not.toContain('icons/madar-192.png');
      const ar = renderSigninMail(kind, 'ar', { name: 'سارة', link }, undefined, { appUrl: APP, brand: { name: 'أكمي', logoUrl: brand.logoUrl } });
      expect(ar.html).toContain('أكمي');
    }
  });

  it('shows the name and logo in the notice mail and the agent code mail', () => {
    const notice = renderMail('notice', 'en', { trigger: 'task_assigned', link }, {}, { appUrl: APP, brand });
    expect(notice.html).toContain('Acme Co');
    expect(notice.html).toContain(brand.logoUrl);
    const code = renderConfirmMail('en', { act: { key: 'usersCreate', target: { name: 'X', nameAr: 'س' } } as never, agent: 'Claude', code: '123456', appUrl: APP, brand });
    expect(code.html).toContain('Acme Co');
  });

  it('escapes a name with a tag', () => {
    const mail = renderSigninMail('invite', 'en', { name: 'Sara', link }, undefined, { appUrl: APP, brand: { name: '<b>x</b>' } });
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>x</b>');
  });

  it('with no brand the page is the old page (the Madar mark and the Madar name)', () => {
    const plain = renderSigninMail('invite', 'en', { name: 'Sara', link }, undefined, { appUrl: APP });
    expect(plain.html).toContain('icons/madar-192.png');
    expect(plain.html).toContain('>Madar<');
    expect(renderSigninMail('invite', 'en', { name: 'Sara', link }, undefined, { appUrl: APP, brand: undefined }).html).toBe(plain.html);
  });

  it('keeps the Madar mark for an enterprise with a name and no logo', () => {
    const mail = renderSigninMail('invite', 'en', { name: 'Sara', link }, undefined, { appUrl: APP, brand: { name: 'Acme Co' } });
    expect(mail.html).toContain('Acme Co');
    expect(mail.html).toContain('icons/madar-192.png');
  });
});
