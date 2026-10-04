import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { calls, type CallOutput } from '../../../api/calls';
import { createApi } from '../../../api/client';
import { FREE_PLAN_LIMITS } from '../../../api/contract/server';
import { memoryPersister } from '../../../api/persist';
import { Store } from '../../../api/store';
import { RuntimeProvider, createQueryClient } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { buildSeed } from '../../../data/seed';
import { initI18n } from '../../../i18n';
import { setNow } from '../../../lib/dates';
import { NOW, TODAY } from '../../../test/factories';
import { expectCalm } from '../../auth/calmChecks';
import { UsageSection } from './UsageSection';

// The build flag, switched per test: the section shows in the remote build only.
const mode = vi.hoisted(() => ({ REMOTE: true, PROTOTYPE: false }));
vi.mock('../../../app/mode', () => mode);

type Usage = CallOutput<'usage.get'>;
const GB = 1024 * 1024 * 1024;
// NOW is 2026-09-30 06:00 UTC, 09:00 in the office.
const RECENT = '2026-09-30T08:50:00.000+03:00';

function usage(more: Partial<Usage> = {}): Usage {
  const meter = (limit: number, used = 0) => ({ used, limit });
  return {
    month: '2026-09',
    calls: meter(FREE_PLAN_LIMITS.calls, 1200),
    database: meter(FREE_PLAN_LIMITS.databaseBytes, 40 * 1024 * 1024),
    files: meter(FREE_PLAN_LIMITS.filesBytes, 0.2 * GB),
    backupCopy: meter(FREE_PLAN_LIMITS.backupCopyBytes),
    emails: meter(FREE_PLAN_LIMITS.emailsPerDay, 4),
    emailsMonth: meter(FREE_PLAN_LIMITS.emailsPerMonth, 60),
    egress: meter(FREE_PLAN_LIMITS.egressBytes, 0.1 * GB),
    failedEffects: [],
    jobsLastRun: RECENT,
    ...more,
  };
}

async function renderUsage(given: Usage, o: { lang?: 'en' | 'ar' } = {}) {
  setNow(NOW);
  const store = new Store(await buildSeed(TODAY, async () => undefined), memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  const asked: string[] = [];
  const retried: unknown[] = [];
  const original = api.call.bind(api);
  api.call = ((name: string, input: unknown, meta?: unknown) => {
    if (name === 'usage.get') {
      asked.push(name);
      return Promise.resolve(given);
    }
    if (name === 'usage.retryEffect') {
      retried.push(input);
      return Promise.resolve({ retried: true });
    }
    return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
  }) as typeof api.call;
  const i18n = initI18n(o.lang ?? 'en');
  const view = render(
    <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
      <ToastProvider>
        <div dir={o.lang === 'ar' ? 'rtl' : 'ltr'}>
          <UsageSection />
        </div>
      </ToastProvider>
    </RuntimeProvider>,
  );
  const t = i18n.t.bind(i18n);
  const section = (await screen.findByRole('heading', { level: 2, name: t('usage.title') })).closest('section')!;
  return { ...view, section, asked, retried, t };
}

afterEach(() => {
  mode.REMOTE = true;
  mode.PROTOTYPE = false;
  initI18n('en');
});

describe('Admin, Usage (plan 5.8; task M1)', () => {
  it('shows one calm line when every meter is under 80%, no effect failed and the job ran in the last 30 minutes', async () => {
    const { section } = await renderUsage(usage());
    expect(await within(section).findByText('All within the free plan.')).toBeInTheDocument();
    expect(within(section).queryByRole('progressbar')).toBeNull();
    expect(within(section).queryByRole('button')).toBeNull();
    expectCalm(section, { titleLevel: 2 });
  });

  it('opens a meter at 85% as one bar with its one next step: file storage on Supabase Storage names the move to R2 or removing old versions', async () => {
    const { section } = await renderUsage(usage({ files: { used: 0.85 * GB, limit: GB } }));
    const bar = await within(section).findByRole('progressbar', { name: 'File storage' });
    expect(bar).toHaveAttribute('aria-valuenow', '85');
    expect(within(section).getAllByRole('progressbar')).toHaveLength(1);
    expect(within(section).getByText('File storage: 85% of the free plan limit')).toBeInTheDocument();
    expect(within(section).getByText('Next step: move the files to Cloudflare R2, or remove old file versions.')).toBeInTheDocument();
    expect(within(section).queryByText('All within the free plan.')).toBeNull();
    expectCalm(section, { titleLevel: 2 });
  });

  it('names the R2 step when the files are on R2 (a 10 GB limit)', async () => {
    const { section } = await renderUsage(usage({ files: { used: 8.5 * GB, limit: 10 * GB } }));
    expect(await within(section).findByText('Above 10 GB, R2 charges about $0.015 for each GB a month. No action is needed.')).toBeInTheDocument();
  });

  it('shows a failed effect as one line with one Retry, which sends usage.retryEffect with the row id and loads the usage again', async () => {
    const failed = { id: '17', kind: 'auth.invite', error: 'Auth said no.', attempts: 5, createdAt: '2026-09-30T08:00:00.000+03:00' };
    const { section, asked, retried } = await renderUsage(usage({ failedEffects: [failed] }));
    const line = await within(section).findByText('Could not send an invitation email. Tries: 5.');
    // The raw error stays on the server log: the Admin reads plain words.
    expect(within(section).queryByText(/Auth said no/)).toBeNull();
    const buttons = within(section).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Retry']);
    expect(buttons[0]).toHaveAccessibleDescription(line.textContent!);
    expectCalm(section, { titleLevel: 2 });
    const before = asked.length;
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(retried).toEqual([{ id: '17' }]));
    await waitFor(() => expect(asked.length).toBe(before + 1));
  });

  it('gives each effect kind plain words, and one line for the live updates that did not arrive', async () => {
    const at = '2026-09-30T08:00:00.000+03:00';
    const effects = ['auth.email', 'auth.ban', 'auth.unban', 'agents.revokeAll', 'mail.notice', 'mail.quotaWarning', 'usage.limitWarning', 'r2.delete', 'something.new']
      .map((kind, i) => ({ id: String(i + 1), kind, error: null, attempts: 1, createdAt: at }));
    const { section } = await renderUsage(usage({ failedEffects: [{ kind: 'realtime.signal', error: '2 change signals were not sent this month.', attempts: 2, createdAt: at }, ...effects] }));
    await within(section).findByText('Some live updates did not reach the screens today. The screens load the changes again by themselves.');
    for (const what of ['change a sign-in email', 'turn off a sign-in', 'turn on a sign-in again', 'sign out an agent', 'send a notice email', 'remove the data of deleted files', 'finish a step in the background']) {
      expect(within(section).getByText(`Could not ${what}. Tries: 1.`)).toBeInTheDocument();
    }
    expect(within(section).getAllByText('Could not send a warning email to an Admin. Tries: 1.')).toHaveLength(2);
    // One Retry for each effect with an id. The line of the live updates has no id and no button: the screens catch up alone.
    expect(within(section).getAllByRole('button', { name: 'Retry' })).toHaveLength(effects.length);
    expect(within(section).getAllByRole('button')).toHaveLength(effects.length);
    expectCalm(section, { titleLevel: 2 });
  });

  it('shows one error line when the job has not run for 30 minutes, and when it never ran', async () => {
    const late = await renderUsage(usage({ jobsLastRun: '2026-09-30T08:20:00.000+03:00' }));
    expect(await within(late.section).findByText(/^The 15-minute job has not run since /)).toBeInTheDocument();
    // The office clock: 08:20 in Riyadh.
    expect(within(late.section).getByText(/^The 15-minute job has not run since /)).toHaveTextContent(/08:20/);
    expect(within(late.section).queryByText('All within the free plan.')).toBeNull();
    // The late job has no Retry here: one Check again loads the usage again.
    expect(within(late.section).getAllByRole('button').map((b) => b.textContent)).toEqual(['Check again']);
    expectCalm(late.section, { titleLevel: 2 });
    late.unmount();
    const never = await renderUsage(usage({ jobsLastRun: null }));
    expect(await within(never.section).findByText('The 15-minute job has not run yet. Reminders, emails and these meters wait for it.')).toBeInTheDocument();
  });

  it('keeps the calm line for a job that ran 29 minutes ago', async () => {
    const { section } = await renderUsage(usage({ jobsLastRun: '2026-09-30T08:31:00.000+03:00' }));
    expect(await within(section).findByText('All within the free plan.')).toBeInTheDocument();
  });

  it('reads right to left in Arabic: the calm line, then a meter at 85% with its next step and a failed effect, with the calm checks', async () => {
    const calm = await renderUsage(usage(), { lang: 'ar' });
    expect(await within(calm.section).findByText(calm.t('usage.allWell'))).toBeInTheDocument();
    expect(calm.section.closest('[dir]')).toHaveAttribute('dir', 'rtl');
    expectCalm(calm.section, { titleLevel: 2 });
    calm.unmount();

    const failed = { id: '3', kind: 'mail.notice', error: null, attempts: 2, createdAt: '2026-09-30T08:00:00.000+03:00' };
    const { section, t, retried } = await renderUsage(usage({ files: { used: 0.85 * GB, limit: GB }, failedEffects: [failed] }), { lang: 'ar' });
    expect(section.closest('[dir]')).toHaveAttribute('dir', 'rtl');
    expect(await within(section).findByRole('progressbar', { name: t('usage.meters.files') })).toHaveAttribute('aria-valuenow', '85');
    expect(within(section).getByText(t('usage.next.files'))).toBeInTheDocument();
    expect(within(section).getByText(t('usage.failed', { what: t('usage.effects.notice'), count: 2 }))).toBeInTheDocument();
    const retry = within(section).getByRole('button', { name: t('common.retry') });
    expect(within(section).getAllByRole('button')).toEqual([retry]);
    expectCalm(section, { titleLevel: 2 });
    await userEvent.click(retry);
    await waitFor(() => expect(retried).toEqual([{ id: '3' }]));
  });

  it('shows nothing in the prototype build', async () => {
    mode.REMOTE = false;
    mode.PROTOTYPE = true;
    const store = new Store(await buildSeed(TODAY, async () => undefined), memoryPersister());
    const api = createApi(calls, { store, latencyMs: 0 });
    const { container } = render(
      <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
        <UsageSection />
      </RuntimeProvider>,
    );
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });
});
