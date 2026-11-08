import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnterpriseView } from '../../api/contract/platform';
import { NotFound } from '../../app/RouteError';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { EnterpriseLogo } from './EnterpriseLogo';
import { EnterpriseSheet, nameOf } from './EnterpriseSheet';
import { hasStatus } from './limits';
import { MeterStrip } from './MeterStrip';
import { NewEnterpriseSheet } from './NewEnterpriseSheet';
import { usePlatform } from './usePlatform';

/**
 * The page "Madar enterprises" (design 5.6 and 5.18): for a platform owner only. A person without the flag sees the page of a wrong link, and
 * no platform call runs. The top shows today's use of the free limits. Below is one list and one button, New enterprise. A row opens its sheet.
 * The page shows no project, task, chat, file or person of an enterprise: only counts, names and the first Admin of the enterprises the owner made.
 */
export function EnterprisesScreen() {
  const session = useCall('session.get', {}).data;
  if (!session) return null;
  if (session.platformOwner !== true) return <NotFound />;
  return <OwnerPage />;
}

function OwnerPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const platform = usePlatform();
  const me = useQuery({ queryKey: ['platform', 'me'], queryFn: () => platform['platform.me']({}) });
  const list = useQuery({ queryKey: ['platform', 'list'], queryFn: () => platform['platform.enterprises.list']({}) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ from?: EnterpriseView } | null>(null);
  const opened = list.data?.find((row) => row.id === openId);
  const closed = me.data?.createOpen === false;
  return (
    <>
      <ScreenTitle
        title={t('enterprises.title')}
        action={<Button variant="primary" disabled={me.isPending || closed} onClick={() => setCreating({})}>{t('enterprises.new')}</Button>}
      >
        {closed && <span>{t('enterprises.createClosed')}</span>}
      </ScreenTitle>
      <div className="flex flex-col gap-5">
        <MeterStrip />
        <LoadFailed query={list} />
        {list.data && (
          <ul className="surface flex flex-col divide-y divide-hairline rounded-card">
            {list.data.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => setOpenId(row.id)} className="pressable flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-start">
                  <EnterpriseLogo logo={row.logo} name={nameOf(row, lang)} size={36} />
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink"><bdi>{nameOf(row, lang)}</bdi></span>
                  <span className="text-footnote font-medium text-ink-2">{t(`enterprises.state.${row.state}`)}</span>
                  <span className="text-footnote text-ink-2">{hasStatus(row) ? t('enterprises.peopleCount', { count: row.people, n: row.people }) : t('enterprises.notCounted')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {opened && (
        <EnterpriseSheet
          row={opened}
          open
          onOpenChange={(open) => !open && setOpenId(null)}
          onTryAgain={(row) => {
            setOpenId(null);
            setCreating({ from: row });
          }}
        />
      )}
      <NewEnterpriseSheet open={creating !== null} onOpenChange={(open) => !open && setCreating(null)} {...(creating?.from ? { from: creating.from } : {})} />
    </>
  );
}
