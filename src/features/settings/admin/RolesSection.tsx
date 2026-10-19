import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OfficeRight, RoleSettings, User } from '../../../api/contract/entities';
import { DEFAULT_RIGHTS, OFFICE_RIGHTS } from '../../../api/permissions';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { RoleSheet, type RoleChoice, type RoleHolder, type RoleTarget } from './RoleSheet';

const BUILT_IN = ['management', 'accounting', 'member'] as const;

/**
 * The Admin page section that sets the rights of each role (owner, 2026-10-18, fbk_014; ADM-12). One calm row for each role: its name,
 * how many people hold it and how many rights it has. A press on a row opens the sheet of that role, where the people, the rights and
 * the save are. The Admin holds every right and is a locked row. "New role" is the one main button.
 */
export function RolesSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const personName = usePersonName();
  const settings = useCall('settings.get', {});
  const users = useCall('users.list', { includeInactive: true });
  const roles: RoleSettings = settings.data?.roles ?? {};
  const [shown, setShown] = useState<RoleTarget | null>(null);
  const rightsOf = (role: (typeof BUILT_IN)[number]): readonly OfficeRight[] => roles.rights?.[role] ?? DEFAULT_RIGHTS[role];
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && !user.removed);
  const holdersOf = (match: (user: User) => boolean): RoleHolder[] => people.filter(match).map((user) => ({ id: user.id, name: personName(user) }));
  const builtInHolders = (role: (typeof BUILT_IN)[number]) => holdersOf((user) => user.systemRole === role && (role !== 'member' || !user.roleId));
  const customHolders = (id: string) => holdersOf((user) => user.roleId === id);
  const customName = (role: { name: string; nameAr: string }) => (lang === 'ar' ? role.nameAr : role.name);
  const custom = roles.custom ?? [];

  const rows: { id: string; name: string; holders: number; rights: number; target: RoleTarget }[] = [
    ...BUILT_IN.map((role) => ({
      id: role, name: t(`admin.roles.${role}`), holders: builtInHolders(role).length, rights: rightsOf(role).length,
      target: { kind: 'built-in' as const, key: role, name: t(`admin.roles.${role}`), rights: rightsOf(role) },
    })),
    ...custom.map((role) => ({
      id: role.id, name: customName(role), holders: customHolders(role.id).length, rights: role.rights.length, target: { kind: 'custom' as const, role },
    })),
  ];
  const shownId = shown?.kind === 'custom' ? shown.role.id : shown?.kind === 'built-in' ? shown.key : null;
  // The roles that the people of a deleted custom role can take: the built-in roles that are not Admin, and the other custom roles.
  const moveChoices: RoleChoice[] = [
    ...BUILT_IN.slice().reverse().map((role) => ({ value: role, label: t(`admin.roles.${role}`) })),
    ...custom.filter((role) => role.id !== shownId).map((role) => ({ value: role.id, label: customName(role) })),
  ];
  const holders = shown?.kind === 'built-in' ? builtInHolders(shown.key) : shown?.kind === 'custom' ? customHolders(shown.role.id) : [];
  const peopleText = (count: number) => (count === 0 ? t('roles.noPeople') : t('roles.peopleCount', { count }));

  return (
    <section aria-labelledby="admin-roles" className="surface flex flex-col gap-3 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-roles" className="text-headline">{t('roles.title')}</h2>
        <Button onClick={() => setShown({ kind: 'new' })}>{t('roles.new')}</Button>
      </div>
      <p className="text-footnote text-label-2">{t('roles.intro')}</p>
      <ul className="hairline flex flex-col">
        <li className="flex min-h-14 flex-col justify-center px-2 py-2">
          <bdi className="font-semibold text-ink">{t('admin.roles.admin')}</bdi>
          <span className="text-footnote text-ink-2">{t('roles.everything')}</span>
        </li>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setShown(row.target)}
              className="pressable flex min-h-14 w-full flex-col justify-center rounded-xl px-2 py-2 text-start hover:bg-fill"
            >
              <bdi className="font-semibold text-ink">{row.name}</bdi>
              <span className="text-footnote text-ink-2">
                {t('roles.rowMeta', { people: peopleText(row.holders), rights: t('roles.rightsCount', { count: row.rights, total: OFFICE_RIGHTS.length }) })}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <RoleSheet
        open={shown !== null}
        onOpenChange={(open) => { if (!open) setShown(null); }}
        target={shown}
        holders={holders}
        moveChoices={moveChoices}
      />
    </section>
  );
}
