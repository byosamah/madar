import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Language } from '../../api/contract/entities';
import { errorMessage } from '../../app/errors';
import { REMOTE } from '../../app/mode';
import { useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { LoadFailed } from '../../components/LoadFailed';
import { formatDay, stampDay } from '../../lib/dates';
import { FormError } from '../auth/AuthPage';
import { useOAuth } from '../oauth/oauthPort';
import { SettingsSection as Section } from './Section';

/**
 * Settings, Agents (plan 5.6; task G4): the AI apps that act for the person. The prototype has no OAuth server, so the section
 * shows in the real build only.
 *
 * - The rows: the active agents of agents.list, then the grants of Auth (listGrants) whose client no active agent has. Such a
 *   grant has access to the account at Auth but no approval in Madar (for example an approval that an agent token made for a
 *   client of its own, proof.md G4), so it can never act in Madar, and the person can remove it.
 * - Remove of an agent: agents.remove first (it removes every link and turns the agent off, so the next MCP call fails at once),
 *   then revokeGrant for each of its clients. When a revoke fails, the agent stays off and one Retry revokes what is left.
 * - Remove of a grant with no agent: revokeGrant only.
 */
export function AgentsSection() {
  return REMOTE ? <Agents /> : null;
}

type Item = { key: string; name: string; meta: string; agentId: string | null; clientIds: string[] };
type Unfinished = { name: string; clientIds: string[] };

/** Revokes each client at Auth and gives back the ones that failed. */
async function revokeEach(revoke: (clientId: string) => Promise<void>, clientIds: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const clientId of clientIds) {
    try {
      await revoke(clientId);
    } catch {
      failed.push(clientId);
    }
  }
  return failed;
}

function Agents() {
  const { t, i18n } = useTranslation();
  const language = (i18n.language === 'ar' ? 'ar' : 'en') as Language;
  const { api } = useRuntime();
  const { port } = useOAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const agents = useCall('agents.list', {});
  const grants = useQuery({ queryKey: ['oauth', 'grants'], queryFn: () => port.listGrants(), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished | null>(null);

  const active = (agents.data ?? []).filter((agent) => agent.active);
  const linked = new Set(active.flatMap((agent) => agent.clientIds));
  const items: Item[] = [
    ...active.map((agent) => ({
      key: agent.agentId,
      name: agent.name,
      meta: [agent.redirectHost, agent.lastUsedAt ? t('agents.lastUsed', { date: formatDay(stampDay(agent.lastUsedAt), language) }) : t('agents.notUsed')].filter(Boolean).join(' · '),
      agentId: agent.agentId,
      clientIds: agent.clientIds,
    })),
    ...(grants.data ?? []).filter((grant) => !linked.has(grant.clientId)).map((grant) => ({
      key: `grant:${grant.clientId}`,
      name: grant.clientName || grant.clientId,
      meta: t('agents.noApproval'),
      agentId: null,
      clientIds: [grant.clientId],
    })),
  ];

  const reload = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['api', 'agents.list'] }),
    queryClient.invalidateQueries({ queryKey: ['oauth', 'grants'] }),
  ]);

  const finish = async (name: string, clientIds: string[]) => {
    const failed = await revokeEach((clientId) => port.revokeGrant(clientId), clientIds);
    setUnfinished(failed.length > 0 ? { name, clientIds: failed } : null);
    await reload();
    return failed.length === 0;
  };

  const remove = async (item: Item) => {
    setBusy(item.key);
    try {
      if (item.agentId !== null) await api.call('agents.remove', { agentId: item.agentId });
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
      setBusy(null);
      return;
    }
    if (await finish(item.name, item.clientIds)) toast.show({ message: t('agents.removed', { name: item.name }) });
    setBusy(null);
  };

  const retry = async () => {
    if (!unfinished) return;
    setBusy('retry');
    await finish(unfinished.name, unfinished.clientIds);
    setBusy(null);
  };

  return (
    <Section title={t('agents.title')}>
      <p className="text-subheadline text-ink-2">{t('agents.intro')}</p>
      <LoadFailed query={agents} />
      {/* The grants are the only place where an app with access but no approval in Madar shows, so a failed list says so. */}
      <LoadFailed query={grants} />
      {agents.data && items.length === 0 && grants.isSuccess && <p className="text-body text-ink-2">{t('agents.none')}</p>}
      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-hairline">
          {items.map((item) => (
            <li key={item.key} aria-label={item.name} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-semibold text-ink">{item.name}</p>
                <p className="text-footnote text-ink-2">{item.meta}</p>
              </div>
              <Button aria-label={t('agents.removeName', { name: item.name })} disabled={busy !== null} onClick={() => void remove(item)}>
                {t('agents.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {unfinished && (
        <div className="flex flex-col items-start gap-2">
          <FormError text={t('agents.revokeFailed', { name: unfinished.name })} />
          <Button disabled={busy !== null} onClick={() => void retry()}>{t('common.retry')}</Button>
        </div>
      )}
    </Section>
  );
}
