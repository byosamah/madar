import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomRole, RoleSettings } from '../../../api/contract/entities';
import { DEFAULT_RIGHTS, OFFICE_RIGHTS } from '../../../api/permissions';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { RightSwitch, RoleSheet, withRight } from './RoleSheet';

const BUILT_IN = ['management', 'accounting', 'member'] as const;

/**
 * The Admin page section that sets the rights of each role (owner, 2026-10-18, fbk_014). The Admin holds every right and is locked.
 * Each switch changes one right of one role, with an Undo. The custom roles open their own sheet, to change the name or to delete.
 */
export function RolesSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const settings = useCall('settings.get', {});
  const roles: RoleSettings = settings.data?.roles ?? {};
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const change = useUndoable('roles.update', { message: () => t('roles.saved') });
  const builtIn = (role: (typeof BUILT_IN)[number]) => roles.rights?.[role] ?? DEFAULT_RIGHTS[role];
  const nameOf = (role: CustomRole) => (lang === 'ar' ? role.nameAr : role.name);
  return (
    <section aria-labelledby="admin-roles" className="surface flex flex-col gap-4 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-roles" className="text-headline">{t('roles.title')}</h2>
        <Button onClick={() => setCreating(true)}>{t('roles.new')}</Button>
      </div>
      <p className="text-footnote text-label-2">{t('roles.intro')}</p>
      <RoleBlock id="admin-role-admin" title={t('admin.roles.admin')}>
        <p className="text-body text-label-2">{t('roles.everything')}</p>
      </RoleBlock>
      {BUILT_IN.map((role) => (
        <RoleBlock key={role} id={`admin-role-${role}`} title={t(`admin.roles.${role}`)}>
          {OFFICE_RIGHTS.map((right) => (
            <RightSwitch
              key={right} id={`role-${role}-${right}`} right={right} checked={builtIn(role).includes(right)}
              onChange={(on) => change.mutate({ role, rights: withRight(builtIn(role), right, on) })}
            />
          ))}
        </RoleBlock>
      ))}
      {(roles.custom ?? []).map((role) => (
        <RoleBlock
          key={role.id} id={`admin-role-${role.id}`} title={nameOf(role)}
          action={<Button variant="plain" onClick={() => setEditing(role)}>{t('roles.edit')}</Button>}
        >
          {OFFICE_RIGHTS.map((right) => (
            <RightSwitch
              key={right} id={`role-${role.id}-${right}`} right={right} checked={role.rights.includes(right)}
              onChange={(on) => change.mutate({ role: role.id, rights: withRight(role.rights, right, on) })}
            />
          ))}
        </RoleBlock>
      ))}
      <RoleSheet open={creating} onOpenChange={setCreating} role={null} />
      <RoleSheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} role={editing} />
    </section>
  );
}

/** One role: its name (a region, so a screen reader finds the role), its action, and its switches. */
function RoleBlock({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="hairline flex flex-col gap-1 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={id} className="text-subheadline font-semibold"><bdi>{title}</bdi></h3>
        {action}
      </div>
      {children}
    </section>
  );
}
