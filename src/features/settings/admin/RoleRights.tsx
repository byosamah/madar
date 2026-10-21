import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RIGHT_INFO, type CatalogRightId } from '../../../api/rightsCatalog';
import { useLang } from '../../../app/lang';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { ChevronRightIcon } from '../../../components/icons/animated/chevron-right';
import { listFormat } from '../../../lib/dates';
import { RoleToggle } from './RoleToggle';
import {
  SHEET_SECTIONS, outsideNeeds, powerKey, sectionState, withRight, withSection, type SheetPower, type SheetSection,
} from './roleSheetLogic';

const switchId = (id: string) => `role-sw-${id.replace(/\./g, '-')}`;

/**
 * One power of a role: its name, its line, and one small switch for each scope (with the scope word), or one switch for a power with one
 * switch. A line "Needs: ..." shows when a switch of the power needs another power that is off and the line of the power does not name it.
 */
function PowerRow({ power, held, onChange }: { power: SheetPower; held: readonly CatalogRightId[]; onChange: (next: CatalogRightId[]) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const label = t(`roleRights.powers.${power.key}.label`);
  const hint = t(`roleRights.powers.${power.key}.hint`);
  const labelId = `${switchId(power.power)}-label`;
  const hintId = `${switchId(power.power)}-hint`;
  const missing = outsideNeeds(power).filter((id) => !held.includes(id));
  const names = [...new Set(missing.map((id) => t(`roleRights.powers.${powerKey(RIGHT_INFO[id].power)}.label`)))].filter((name) => !hint.includes(name));
  const scoped = power.switches.some((item) => item.scope !== null);
  const toggles = power.switches.map((item) => (
    <RoleToggle
      key={item.id} id={switchId(item.id)} name={item.scope === null ? label : t('roleRights.nameScope', { label, scope: t(`roleRights.scopes.${item.scope}`) })}
      word={item.scope === null ? undefined : t(`roleRights.scopes.${item.scope}`)} state={held.includes(item.id)} describedBy={hintId}
      onChange={(on) => onChange(withRight(held, item.id, on))}
    />
  ));
  return (
    <div className="flex flex-col gap-1 border-t border-hairline py-2 first:border-t-0">
      <div className={scoped ? 'flex flex-col gap-1' : 'flex min-h-11 items-center justify-between gap-4'}>
        <div className="min-w-0">
          <p id={labelId} className="text-body">{label}</p>
          <p id={hintId} className="text-footnote text-label-2">{hint}</p>
          {names.length > 0 && <p className="text-footnote text-label-2">{t('roleRights.needs', { list: listFormat(lang).format(names) })}</p>}
        </div>
        {scoped ? <div className="flex flex-wrap items-center gap-x-3">{toggles}</div> : toggles}
      </div>
    </div>
  );
}

/** The three lines at the top of the AI section: what an assistant is, the rule, and what it can never do. */
function AiLines() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 py-2">
      <p className="text-footnote text-ink-2">{t('roleRights.aiWhat')}</p>
      <p className="text-footnote text-ink-2">{t('roleRights.aiRule')}</p>
      <p className="text-footnote text-ink-2">{t('roleRights.aiNever')}</p>
    </div>
  );
}

/**
 * The 13 sections of rights (role rights version 2). Sections are folded, and one is open at a time. The heading row holds the name, the
 * count ("4 of 9 on") and the All switch (on, off or mixed). Turning a switch on turns on the switches it needs; turning one off turns off
 * the switches that need it. The sheet keeps the list of held switches and saves it with one button.
 */
export function RoleRights({ held, onChange }: { held: readonly CatalogRightId[]; onChange: (next: CatalogRightId[]) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const section = (item: SheetSection) => {
    const isOpen = open === item.key;
    const on = item.ids.filter((id) => held.includes(id)).length;
    const state = sectionState(held, item.ids);
    const nameId = `role-section-${item.key}`;
    const sectionName = t(`roleRights.sections.${item.key}`);
    const count = t('roleRights.sectionCount', { on, total: item.ids.length });
    return (
      <section key={item.key} aria-labelledby={nameId} className="flex flex-col">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h3 className="min-w-0 flex-1">
            <button
              type="button" aria-expanded={isOpen} aria-controls={`role-body-${item.key}`} aria-label={`${sectionName} ${count}`}
              onClick={() => setOpen(isOpen ? null : item.key)}
              className="pressable flex min-h-11 w-full items-center gap-2 rounded-xl text-start"
            >
              <AnimatedIcon icon={ChevronRightIcon} size={16} className={`shrink-0 text-ink-2 ${isOpen ? 'rotate-90' : 'rtl:-scale-x-100'}`} aria-hidden />
              <span id={nameId} className="field-label">{sectionName}</span>
              <span className="text-footnote text-ink-2">{count}</span>
            </button>
          </h3>
          {item.ids.length > 1 && (
            <RoleToggle
              id={`role-all-${item.key}`} name={t('roleRights.all')} word={t('roleRights.all')} state={state === 'mixed' ? 'mixed' : state === 'on'} all
              onChange={(next) => onChange(withSection(held, item.ids, next))}
            />
          )}
        </div>
        {isOpen && (
          <div id={`role-body-${item.key}`} className="flex flex-col ps-6">
            {item.key === 'ai' && <AiLines />}
            {item.powers.map((power) => <PowerRow key={power.power} power={power} held={held} onChange={onChange} />)}
          </div>
        )}
      </section>
    );
  };
  return <div className="flex flex-col">{SHEET_SECTIONS.map(section)}</div>;
}
