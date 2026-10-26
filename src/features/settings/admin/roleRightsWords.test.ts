import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ar, en } from '../../../i18n/trees';
import { SHEET_SECTIONS } from './roleSheetLogic';

type Json = { scopes: Record<string, { en: string; ar: string }>; sections: { key: string; en: string; ar: string; powers: { power: string; en: string; ar: string; hint: string }[] }[] };
const json = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json'), 'utf8')) as Json;

type Words = { roleRights: { sections: Record<string, string>; scopes: Record<string, string>; powers: Record<string, { label: string; hint: string }> } & Record<string, unknown> };
const words = (tree: object) => (tree as unknown as Words).roleRights;
const EM_DASH = String.fromCharCode(0x2014);

describe('the words of the role sheet (119 switches, 90 powers, 13 sections)', () => {
  it('has the English label and hint of each power word for word from the catalog', () => {
    for (const section of json.sections) {
      expect(words(en).sections[section.key]).toBe(section.en);
      for (const power of section.powers) {
        const key = SHEET_SECTIONS.find((item) => item.key === section.key)!.powers.find((item) => item.power === power.power)!.key;
        expect(words(en).powers[key], power.power).toEqual({ label: power.en, hint: power.hint });
      }
    }
  });

  it('has the Arabic label of each power and each section word for word from the catalog, and an Arabic hint of its own', () => {
    for (const section of json.sections) {
      expect(words(ar).sections[section.key]).toBe(section.ar);
      for (const power of section.powers) {
        const key = SHEET_SECTIONS.find((item) => item.key === section.key)!.powers.find((item) => item.power === power.power)!.key;
        expect(words(ar).powers[key].label, power.power).toBe(power.ar);
        expect(words(ar).powers[key].hint, power.power).toMatch(/[؀-ۿ]/);
        expect(words(ar).powers[key].hint, power.power).not.toBe(words(en).powers[key].hint);
      }
    }
  });

  it('has the five scope words in both languages', () => {
    for (const scope of ['lead', 'team', 'all', 'office', 'none']) {
      expect(words(en).scopes[scope]).toBe(json.scopes[scope].en);
      expect(words(ar).scopes[scope]).toBe(json.scopes[scope].ar);
    }
    expect(words(ar).scopes).toMatchObject({ lead: 'مشاريع أقودها', team: 'مشاريعي', all: 'كل المشاريع', office: 'المكتب', none: 'بلا مشروع' });
  });

  it('has the three approved lines of the AI section in English', () => {
    const r = words(en);
    expect(r.aiWhat).toBe('What it is: an AI app, such as Claude or ChatGPT, that connects to Madar and works for one person.');
    expect(r.aiRule).toBe('The rule: an assistant never does more than its person may do. These switches only take more away from the assistants of this role.');
    expect(r.aiNever).toBe('An assistant can never: delete projects, upload or open files, change people, roles, teams, templates or settings, change or delete clients, delete to-dos, edit or delete messages, or send requests and bugs. It creates projects and clients only with the switch "AI creates projects and clients".');
  });

  it('has the same sheet words in both languages, and no em-dash in any of them', () => {
    const keys = (tree: object): string[] => Object.entries(tree).flatMap(([key, value]) => (typeof value === 'object' && value ? keys(value).map((rest) => `${key}.${rest}`) : [key]));
    expect(keys(words(ar)).sort()).toEqual(keys(words(en)).sort());
    for (const tree of [words(en), words(ar)]) expect(JSON.stringify(tree)).not.toContain(EM_DASH);
  });

  it('writes the Arabic sheet words in plain Arabic and uses the word for the Admin', () => {
    const text = JSON.stringify(words(ar));
    expect(text).not.toContain('المدير ');
    expect(words(ar).all).toBe('الكل');
  });
});
