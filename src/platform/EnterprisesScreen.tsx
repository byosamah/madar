import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnterpriseView } from '../api/contract/platform';
import { useLang } from '../app/lang';
import { Button } from '../components/Button';
import { LoadFailed } from '../components/LoadFailed';
import { ScreenTitle } from '../components/ScreenTitle';
import { EnterpriseLogo } from '../features/enterprises/EnterpriseLogo';
import { EnterpriseSheet, nameOf } from './EnterpriseSheet';
import { hasStatus } from '../features/enterprises/limits';
import { MeterStrip } from './MeterStrip';
import { NewEnterpriseSheet } from './NewEnterpriseSheet';
import { usePlatform } from './usePlatform';

/**
 * The page of the site Madar enterprises (design 5.18 and 12): it shows only to a signed-in platform account (src/platform/PlatformApp.tsx). The top shows
 * today's use of the free limits. Below is one list and one button, New enterprise. A row opens its sheet. The page shows no project, task,
 * chat, file or person of an enterprise: only counts, names and the first Admin of the enterprises the owner made.
 */
export function EnterprisesScreen() {
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
                <button type="button" onClick={() => setOpenId(row.id)} className="pressable flex min-h-14 w-full items-center gap-x-3 px-5 py-3 text-start">
                  <EnterpriseLogo logo={row.logo} name={nameOf(row, lang)} size={36} />
                  {/* The whole name on its own line (it may wrap), and the state and the count under it, so a phone never cuts the name. */}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-body font-medium text-ink [overflow-wrap:anywhere]"><bdi>{nameOf(row, lang)}</bdi></span>
                    <span className="flex flex-wrap gap-x-3 text-footnote text-ink-2">
                      <span className="font-medium">{t(`enterprises.state.${row.state}`)}</span>
                      <span>{hasStatus(row) ? t('enterprises.peopleCount', { count: row.people, n: row.people }) : t('enterprises.notCounted')}</span>
                    </span>
                  </span>
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
