import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { usePersonName } from '../../../app/personName';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { Sheet } from '../../../components/Sheet';
import { actorContext } from '../../../lib/grammar';

/**
 * Remove for Admin, People (owner, 2026-10-12): a turned-off person, or a turned-off agent, who will not come back leaves the list for
 * good. The record stays, so the History keeps the name, and the email stays reserved. Nothing in the screens brings a removed
 * person back, so there is no Undo and the sheet asks first. The agents of a person go with them.
 */
export function useRemove(): { ask: (user: User) => void; sheet: ReactNode } {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const toast = useToast();
  const [pending, setPending] = useState<User | null>(null);
  const remove = useAction('users.remove', { onSuccess: (user) => toast.show({ message: t('admin.removed', { name: nameOf(user) }) }) });
  const sheet = pending && (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) setPending(null); }}
      title={t('admin.removeTitle', { name: nameOf(pending) })}
      footer={(
        <>
          {/* A double press must not remove. Cancel takes the focus, and the confirm goes to the start side, away from the pointer. */}
          <Button variant="destructive" className="me-auto" onClick={() => { remove.mutate({ id: pending.id }); setPending(null); }}>{t('admin.removeConfirm')}</Button>
          <Button autoFocus onClick={() => setPending(null)}>{t('common.cancel')}</Button>
        </>
      )}
    >
      <p dir="auto" className="pt-1 text-body text-ink">{t('admin.removeBody', { context: actorContext(pending) })}</p>
    </Sheet>
  );
  return { ask: setPending, sheet };
}
