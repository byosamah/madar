import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Client } from '../../../api/contract/entities';
import { can } from '../../../api/permissions';
import type { ProjectSummary } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { ProjectTile } from '../../../components/ProjectTile';
import { Sheet } from '../../../components/Sheet';
import { clientName } from '../../../lib/clientName';
import { counted } from '../../../lib/grammar';
import { projectKey } from '../../../lib/projectCode';
import { normalizeForSearch } from '../../../lib/text';
import { ClientForm, useClientForm } from '../../projects/ClientForm';
import { clientPatch, draftOfClient } from '../../projects/clientRules';
import { useProjectName, useByProjectName } from '../../../app/projectName';

/** One client in a sheet: the client form, then the client's projects as links. Save changes only the fields that changed. */
function ClientSheet({ client, clients, projects, onClose }: { client: Client; clients: Client[]; projects: ProjectSummary[]; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const projectName = useProjectName();
  const toast = useToast();
  // An old client may keep no initials. Once given, initials follow the rule, because project codes name them.
  const form = useClientForm(draftOfClient(client), { initialsOptional: !client.initials });
  const update = useAction('clients.update', {
    onSuccess: () => {
      toast.show({ message: t('clientsAdmin.saved') });
      onClose();
    },
  });
  const save = () => {
    if (update.isPending || !form.check()) return;
    const patch = clientPatch(client, form.values, lang);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    update.mutate({ id: client.id, patch });
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={clientName(client, lang)}
      footer={<Button variant="primary" disabled={update.isPending} onClick={save}>{t('admin.save')}</Button>}
    >
      <div className="flex flex-col gap-6 pt-1">
        <ClientForm form={form} idPrefix="admin-client" clients={clients} selfId={client.id} onEnter={save} />
        <section aria-labelledby="admin-client-projects" className="flex flex-col gap-1">
          <h3 id="admin-client-projects" className="field-label">{t('clientsAdmin.projects')}</h3>
          {projects.length === 0 ? (
            <p className="text-subheadline text-ink-2">{t('clientsAdmin.noProjects')}</p>
          ) : (
            <ul aria-labelledby="admin-client-projects" className="hairline flex flex-col">
              {projects.map((summary) => (
                <li key={summary.project.id}>
                  <Link to={`/projects/${summary.project.id}`} className="pressable flex min-h-12 items-center gap-3 py-2 text-link">
                    <ProjectTile id={summary.project.id} mark={summary.project.mark} shape={summary.project.shape} size={28} subCompanyId={summary.subCompanyId} />
                    <bdi className="min-w-0 flex-1 truncate font-semibold">{projectName(summary.project)}</bdi>
                    <span dir="ltr" className="tabular text-footnote text-ink-2">{projectKey(summary.project.code)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}

/**
 * The office's clients (owner, 2026-10-05, item 3), Admin only: one search field and one row for each client, with the name
 * in the screen language, the initials of the project code and the number of projects. A press opens the client in a sheet.
 * The Admin frame registers this section (merge lead); this file only draws it.
 */
export function ClientsSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const byProjectName = useByProjectName();
  const session = useCall('session.get', {});
  const clients = useCall('clients.list', {});
  const projects = useCall('projects.list', { status: 'all' });
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  // The clients of the office are for the people with the client right (fbk_014). The Admin holds it.
  if (!session.data || !can(session.data.authority, 'clients.change')) return null;

  const all = clients.data ?? [];
  const byClient = new Map<string, ProjectSummary[]>();
  for (const summary of projects.data ?? []) {
    if (!summary.project.clientId) continue;
    byClient.set(summary.project.clientId, [...(byClient.get(summary.project.clientId) ?? []), summary]);
  }
  const wanted = normalizeForSearch(query);
  const shown = all
    .filter((client) => !wanted || normalizeForSearch([client.name, client.nameAr ?? '', client.initials ?? ''].join(' ')).includes(wanted))
    .sort((a, b) => clientName(a, lang).localeCompare(clientName(b, lang), lang));
  const opened = all.find((client) => client.id === openId);

  return (
    <section aria-labelledby="admin-clients" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-clients" className="text-headline">{t('clientsAdmin.title')}</h2>
      <TextField
        id="clients-search" type="search" label={t('clientsAdmin.search')} dir="auto" autoComplete="off" value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <LoadFailed query={clients} />
      {clients.data && all.length === 0 && <p className="text-subheadline text-ink-2">{t('clientsAdmin.empty')}</p>}
      {all.length > 0 && shown.length === 0 && <p className="text-subheadline text-ink-2">{t('clientsAdmin.noMatch')}</p>}
      {shown.length > 0 && (
        <ul className="hairline flex flex-col">
          {shown.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => setOpenId(client.id)}
                className="pressable flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-fill"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <bdi className="truncate font-semibold text-ink">{clientName(client, lang)}</bdi>
                  <span className="text-footnote text-ink-2">{counted(t, 'clientsAdmin.count', byClient.get(client.id)?.length ?? 0)}</span>
                </span>
                {client.initials
                  ? <span dir="ltr" className="tabular text-subheadline font-semibold text-ink">{client.initials}</span>
                  : <span className="text-footnote text-ink-2">{t('clientsAdmin.noInitials')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {opened && (
        <ClientSheet
          key={opened.id}
          client={opened}
          clients={all}
          projects={(byClient.get(opened.id) ?? []).sort((a, b) => byProjectName(a.project, b.project))}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}
