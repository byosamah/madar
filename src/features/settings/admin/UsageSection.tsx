import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { CallOutput } from '../../../api/calls';
import { FREE_PLAN_LIMITS } from '../../../api/contract/server';
import { useLang } from '../../../app/lang';
import { REMOTE } from '../../../app/mode';
import { useAction, useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { LoadFailed } from '../../../components/LoadFailed';
import { formatNumber, localeFor, now, OFFICE_TZ, type Lang } from '../../../lib/dates';
import { SettingsSection as Section } from '../Section';

type Usage = CallOutput<'usage.get'>;
type MeterName = 'calls' | 'database' | 'files' | 'backupCopy' | 'emails' | 'emailsMonth' | 'egress';
type FailedEffect = Usage['failedEffects'][number];

const METERS: MeterName[] = ['calls', 'database', 'files', 'backupCopy', 'emails', 'emailsMonth', 'egress'];
/** The 15-minute job is late after 30 minutes (plan 5.5). */
const JOB_LATE_MS = 30 * 60 * 1000;
/** The kind of the line for the change signals that did not arrive (server/usage/meters.ts). */
const SIGNAL_KIND = 'realtime.signal';
/** The plain words of each effect kind (plan 4.12). A new kind reads as a step in the background. */
const EFFECT_WORDS: Record<string, string> = {
  'auth.invite': 'invite',
  'auth.email': 'signInEmail',
  'auth.ban': 'ban',
  'auth.unban': 'unban',
  'agents.revokeAll': 'agents',
  'mail.notice': 'notice',
  'mail.quotaWarning': 'warning',
  'usage.limitWarning': 'warning',
  'r2.delete': 'fileData',
};

const percentOf = (meter: { used: number; limit: number }) => Math.floor((meter.used / meter.limit) * 100);
/** True from four fifths of the limit on, as the 80% warning of the server. */
const overLimit = (meter: { used: number; limit: number }) => meter.used * 5 >= meter.limit * 4;

/** One formatter for each language, built on its first use (performance audit 2026-10-07, RND-1). */
const jobTimeFormats = new Map<Lang, Intl.DateTimeFormat>();

function jobTime(stamp: string, lang: Lang): string {
  let format = jobTimeFormats.get(lang);
  if (!format) {
    format = new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: OFFICE_TZ });
    jobTimeFormats.set(lang, format);
  }
  return format.format(new Date(stamp));
}

/**
 * Admin, Usage (plan 5.8; task M1): the free plan meters, the failed effects and the 15-minute job. Calm by default: one line
 * when all is well. A meter at 80% or more opens as one bar with its one next step; a failed effect is one line with one Retry
 * (usage.retryEffect, plan 4.12), and the line of the live updates needs none; a job that has not run for 30 minutes is one
 * line with one Check again. The prototype has no server, so the section shows in the real build only.
 */
export function UsageSection() {
  return REMOTE ? <UsagePanel /> : null;
}

function UsagePanel() {
  const { t } = useTranslation();
  const query = useCall('usage.get', {});
  return (
    <Section title={t('usage.title')}>
      <LoadFailed query={query} />
      {query.data && <UsageBody usage={query.data} checking={query.isFetching} onCheck={() => void query.refetch()} />}
    </Section>
  );
}

function UsageBody({ usage, checking, onCheck }: { usage: Usage; checking: boolean; onCheck: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const over = METERS.filter((name) => overLimit(usage[name]));
  const failed = usage.failedEffects;
  const lastRun = usage.jobsLastRun;
  const jobLate = lastRun === null || now().getTime() - Date.parse(lastRun) > JOB_LATE_MS;
  if (over.length === 0 && failed.length === 0 && !jobLate) return <p className="text-body text-label-2">{t('usage.allWell')}</p>;

  // On R2 the files limit is 10 GB, above the 1 GB of Supabase Storage, and the next step is another one (plan 2b, point 1).
  const nextOf = (name: MeterName) => (name === 'files' && usage.files.limit > FREE_PLAN_LIMITS.filesBytes ? 'filesR2' : name);
  const lineOf = (effect: FailedEffect) => effect.kind === SIGNAL_KIND
    ? t('usage.signals')
    : t('usage.failed', { what: t(`usage.effects.${EFFECT_WORDS[effect.kind] ?? 'other'}`), count: effect.attempts });

  return (
    <>
      {over.length > 0 && (
        <ul className="flex flex-col gap-4">
          {over.map((name) => {
            const percent = percentOf(usage[name]);
            const label = t(`usage.meters.${name}`);
            return (
              <li key={name} className="flex flex-col gap-1.5">
                <span className="text-body text-ink">{t('usage.meterLine', { meter: label, percent: formatNumber(percent, lang) })}</span>
                <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="block h-1.5 overflow-hidden rounded-full bg-fill">
                  <span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.min(100, percent)}%` }} />
                </span>
                <span className="text-footnote text-label-2">{t(`usage.next.${nextOf(name)}`)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {failed.length > 0 && (
        <ul className="flex flex-col gap-1">
          {failed.map((effect, i) => <FailedLine key={effect.id ?? `${effect.kind}-${i}`} id={effect.id} text={lineOf(effect)} onDone={onCheck} />)}
        </ul>
      )}
      {jobLate && <p className="text-body text-ink">{lastRun === null ? t('usage.jobNever') : t('usage.jobLate', { time: jobTime(lastRun, lang) })}</p>}
      {jobLate && (
        <div>
          <Button onClick={onCheck} disabled={checking}>{t('usage.checkAgain')}</Button>
        </div>
      )}
    </>
  );
}

/** One failed effect: its plain words, and one Retry when it has a row id. After the Retry the usage loads again. */
function FailedLine({ id, text, onDone }: { id?: string; text: string; onDone: () => void }) {
  const { t } = useTranslation();
  const lineId = useId();
  const retry = useAction('usage.retryEffect');
  return (
    <li className="flex items-center justify-between gap-3">
      <span id={lineId} className="text-body text-ink">{text}</span>
      {id !== undefined && (
        <Button variant="plain" className="shrink-0" aria-describedby={lineId} disabled={retry.isPending} onClick={() => retry.mutate({ id }, { onSettled: onDone })}>
          {t('common.retry')}
        </Button>
      )}
    </li>
  );
}
