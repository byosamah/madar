import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { clientName } from '../lib/clientName';
import { clientParam, subCompanyParam, teamParam, userParam } from '../lib/params';
import { useLang } from './lang';
import { usePersonName } from './personName';
import { useCall } from './runtime';

/**
 * The Dashboard filters in the link: the office team, the leader, the client and the sub-company. The Dashboard sends them, so the list holds the
 * tasks it counted, and the subtitle names each one (audit 2026-10-03, V-37a; owner, 2026-10-06, item 3).
 */
export function useScope(): { teamId?: string; leaderId?: string; clientId?: string; subCompanyId?: string; scopeText: string } {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const [params] = useSearchParams();
  const teamId = teamParam(params.get('team'));
  const leaderId = userParam(params.get('leader'));
  const clientId = clientParam(params.get('client'));
  const subCompanyId = subCompanyParam(params.get('subCompany'));
  const subCompanies = useCall('subCompanies.list', {}, { enabled: subCompanyId !== undefined });
  const teams = useCall('teams.list', {}, { enabled: teamId !== undefined });
  const users = useCall('users.list', { includeInactive: true }, { enabled: leaderId !== undefined });
  const clients = useCall('clients.list', {}, { enabled: clientId !== undefined });
  const team = teams.data?.find((item) => item.id === teamId);
  const leader = users.data?.find((user) => user.id === leaderId);
  const client = clients.data?.find((item) => item.id === clientId);
  const subCompany = subCompanies.data?.find((item) => item.id === subCompanyId);
  const scopeText = [
    team ? t('taskList.team', { name: team.name }) : '',
    leader ? t('taskList.leader', { name: nameOf(leader) }) : '',
    client ? t('taskList.client', { name: clientName(client, lang) }) : '',
    subCompany ? t('taskList.subCompany', { name: lang === 'ar' ? subCompany.nameAr : subCompany.name }) : '',
  ].filter(Boolean).join(' · ');
  return { teamId, leaderId, clientId, subCompanyId, scopeText };
}
