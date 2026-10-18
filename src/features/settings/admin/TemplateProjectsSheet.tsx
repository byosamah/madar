import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import type { SyncChoices } from '../../../api/templateSync';
import { newStoryId } from '../../../app/actions';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { Sheet } from '../../../components/Sheet';
import { counted } from '../../../lib/grammar';
import { LinkProjectSheet } from './LinkProjectSheet';
import { ChangeCard, ChangeSummary, DEFAULT_CHOICES, KINDS, changesOf, itemsOf, type SyncRow } from './SyncSteps';

/** The steps in order: pick the projects, ask, each change, check the summary, confirm, run, and the result. */
type Step = 'pick' | 'ask' | 'changes' | 'summary' | 'confirm' | 'running' | 'done';

/** The longest reason that the server keeps (contract limit). */
const REASON_MAX = 280;

/**
 * "Projects using this template" (fbk_008 item 4). The Admin ticks the linked projects. Then the Admin goes through one question,
 * one card for each kind of change, a summary with one reason for any date move, and a last confirm. Nothing is sent before that
 * last confirm. The projects go one after the other under one story, so one Undo all takes back every project of the update.
 */
export function TemplateProjectsSheet({ template, onClose }: { template: ProjectTemplate; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const usage = useCall('projectTemplates.usage', { templateId: template.id });
  const [step, setStep] = useState<Step>('pick');
  const [ticked, setTicked] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [linking, setLinking] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<SyncChoices>(DEFAULT_CHOICES);
  const [reason, setReason] = useState('');
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(false);
  const [story, setStory] = useState<string | null>(null);
  // The plan is read while the Admin chooses changes. A run takes the rows that it had at the confirm, so a read that changes
  // during the run does not change the list of projects.
  const reading = step === 'changes' || step === 'summary' || step === 'confirm';
  const plan = useCall('projectTemplates.syncPlan', { templateId: template.id, projectIds: picked }, { enabled: reading });
  const rows: SyncRow[] = plan.data ?? [];
  const linked = usage.data?.linked ?? [];
  const notLinked = usage.data?.notLinked ?? [];
  const kinds = KINDS.filter((kind) => rows.some((row) => itemsOf(row.diff, kind) > 0));
  const kind = kinds[index];
  const needsReason = rows.some((row) => changesOf(row.diff, choices).includes('dates'));
  const changing = rows.filter((row) => changesOf(row.diff, choices).length > 0);
  const people = new Set(changing.flatMap((row) => row.diff.people)).size;
  const projectWord = (n: number) => counted(t, 'projectTemplates.update.projectCount', n);

  const stateOf = (row: { status: string; staleDays: number | null }) => (
    row.staleDays !== null ? t('status.stale', { count: row.staleDays }) : t(`status.${row.status}`)
  );
  const toggle = (id: string) => setTicked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const start = () => {
    setPicked(ticked);
    setStep('ask');
  };
  const begin = () => {
    setIndex(0);
    setStep('changes');
  };
  const backToChanges = () => {
    setIndex(Math.max(kinds.length - 1, 0));
    setStep(kinds.length > 0 ? 'changes' : 'ask');
  };
  const choose = (pick: Partial<SyncChoices>) => setChoices((current) => ({ ...current, ...pick }));

  // One call for each project, one after the other, under one story. A failed project stops the run; the projects before it stay
  // changed, and Undo all takes them back.
  const run = async () => {
    let storyId = newStoryId();
    setTotal(rows.length);
    setDone(0);
    setFailed(false);
    setStep('running');
    for (const row of rows) {
      try {
        const result = await api.run('projectTemplates.syncApply', {
          templateId: template.id,
          projectId: row.project.id,
          choices,
          ...(changesOf(row.diff, choices).includes('dates') ? { dateReason: reason.trim() } : {}),
        }, { correlationId: storyId });
        storyId = result.storyId;
        setStory(storyId);
        setDone((count) => count + 1);
      } catch (error) {
        toast.failed(error);
        setFailed(true);
        break;
      }
    }
    setStep('done');
  };
  const undo = () => {
    if (story === null) return;
    api.call('events.undoStory', { correlationId: story }).then(() => {
      toast.show({ message: t('projectTemplates.update.undone') });
      onClose();
    }, (error: unknown) => toast.failed(error));
  };

  const title = {
    pick: t('projectTemplates.update.open'),
    ask: t('projectTemplates.update.askTitle', { projects: projectWord(picked.length) }),
    changes: t('projectTemplates.update.changesTitle'),
    summary: t('projectTemplates.update.summaryTitle'),
    confirm: t('projectTemplates.update.confirmTitle'),
    running: t('projectTemplates.update.runningTitle'),
    done: failed ? t('projectTemplates.update.stoppedTitle') : t('projectTemplates.update.doneTitle', { projects: projectWord(done) }),
  }[step];

  const pickBody = (
    <>
      <p className="text-subheadline text-ink-2">{t('projectTemplates.update.intro')}</p>
      <LoadFailed query={usage} />
      {usage.data !== undefined && linked.length + notLinked.length === 0 && (
        <p className="text-subheadline text-ink-2">{t('projectTemplates.update.empty')}</p>
      )}
      {linked.length > 0 && (
        <section aria-labelledby="update-linked" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="update-linked" className="field-label">{t('projectTemplates.update.linked')}</h3>
            <div className="flex gap-2">
              <Button variant="plain" onClick={() => setTicked(linked.map((row) => row.project.id))}>{t('projectTemplates.update.all')}</Button>
              <Button variant="plain" onClick={() => setTicked([])}>{t('projectTemplates.update.none')}</Button>
            </div>
          </div>
          <ul className="hairline flex flex-col">
            {linked.map((row) => (
              <li key={row.project.id}>
                <label className="flex min-h-11 items-center gap-3 py-1 text-body text-ink">
                  <input
                    type="checkbox"
                    checked={ticked.includes(row.project.id)}
                    onChange={() => toggle(row.project.id)}
                    className="size-5 accent-[var(--sig-from)]"
                  />
                  <bdi className="min-w-0 flex-1 truncate">{row.project.name}</bdi>
                  <span className="text-footnote text-ink-2">{stateOf(row)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notLinked.length > 0 && (
        <section aria-labelledby="update-not-linked" className="flex flex-col gap-2">
          <h3 id="update-not-linked" className="field-label">{t('projectTemplates.update.notLinked')}</h3>
          <ul className="hairline flex flex-col">
            {notLinked.map((row) => (
              <li key={row.project.id} className="flex min-h-11 items-center gap-3 py-1">
                <bdi className="min-w-0 flex-1 truncate text-body text-ink">{row.project.name}</bdi>
                <Button
                  aria-label={t('projectTemplates.update.linkNamed', { name: row.project.name })}
                  onClick={() => setLinking(row.project.id)}
                >
                  {t('projectTemplates.update.link')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  const changesBody = (
    <>
      <LoadFailed query={plan} />
      {plan.data !== undefined && kinds.length === 0 && <p className="text-subheadline text-ink-2">{t('projectTemplates.update.nothing')}</p>}
      {plan.data !== undefined && kind !== undefined && (
        <>
          <p className="text-footnote text-ink-2">{t('projectTemplates.update.step', { n: index + 1, total: kinds.length })}</p>
          <ChangeCard key={kind} kind={kind} rows={rows} choices={choices} onChoose={choose} />
        </>
      )}
    </>
  );

  const summaryBody = (
    <>
      <ul className="hairline flex flex-col">
        {rows.map((row) => <ChangeSummary key={row.project.id} row={row} choices={choices} />)}
      </ul>
      {people > 0 && (
        <p className="text-footnote text-ink-2">
          {t('projectTemplates.update.peopleLine', { people: counted(t, 'projectTemplates.update.peopleCount', people) })}
        </p>
      )}
      {needsReason && (
        <TextField
          id="update-reason"
          label={t('projectTemplates.update.reason')}
          required
          maxLength={REASON_MAX}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      )}
    </>
  );

  const body = {
    pick: pickBody,
    ask: <p className="text-subheadline text-ink-2">{t('projectTemplates.update.askBody')}</p>,
    changes: changesBody,
    summary: summaryBody,
    confirm: <p className="text-subheadline text-ink-2">{t('projectTemplates.update.confirmBody')}</p>,
    running: <p className="text-subheadline text-ink-2">{t('projectTemplates.update.running', { n: done + 1, total })}</p>,
    done: <p className="text-subheadline text-ink-2">{t(failed ? 'projectTemplates.update.stoppedBody' : 'projectTemplates.update.doneBody')}</p>,
  }[step];

  // Each footer has a key of its step. A new step makes new buttons, so the focus never stays on the button of the step before.
  // The last confirm starts with the focus on Back, so a stray Enter sends nothing.
  const footer = ((): ReactNode => {
    switch (step) {
      case 'pick': return (
        <Fragment key="pick">
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={ticked.length === 0} onClick={start}>{t('projectTemplates.update.pickNext')}</Button>
        </Fragment>
      );
      case 'ask': return (
        <Fragment key="ask">
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => setStep('pick')}>{t('projectTemplates.update.back')}</Button>
          <Button variant="primary" onClick={begin}>{t('projectTemplates.update.continue')}</Button>
        </Fragment>
      );
      case 'changes': return (
        <Fragment key="changes">
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => (index > 0 ? setIndex(index - 1) : setStep('ask'))}>{t('projectTemplates.update.back')}</Button>
          <Button
            variant="primary"
            disabled={plan.data === undefined}
            onClick={() => (index < kinds.length - 1 ? setIndex(index + 1) : setStep('summary'))}
          >
            {t('projectTemplates.update.next')}
          </Button>
        </Fragment>
      );
      case 'summary': return (
        <Fragment key="summary">
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={backToChanges}>{t('projectTemplates.update.back')}</Button>
          <Button variant="primary" disabled={needsReason && reason.trim() === ''} onClick={() => setStep('confirm')}>
            {t('projectTemplates.update.next')}
          </Button>
        </Fragment>
      );
      case 'confirm': return (
        <Fragment key="confirm">
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button autoFocus onClick={() => setStep('summary')}>{t('projectTemplates.update.back')}</Button>
          <Button variant="primary" onClick={() => { void run(); }}>
            {t('projectTemplates.update.confirm', { projects: projectWord(rows.length) })}
          </Button>
        </Fragment>
      );
      case 'running': return undefined;
      case 'done': return (
        <Fragment key="done">
          {story !== null && <Button onClick={undo}>{t('projectTemplates.update.undoAll')}</Button>}
          <Button variant="primary" onClick={onClose}>{t('common.done')}</Button>
        </Fragment>
      );
    }
  })();

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => { if (!open && step !== 'running') onClose(); }}
        title={title}
        keepOnOutsidePress={step === 'running'}
        footer={footer}
      >
        <div className="flex flex-col gap-4 pt-1">{body}</div>
      </Sheet>
      {linking !== null && <LinkProjectSheet projectId={linking} template={template} onClose={() => setLinking(null)} />}
    </>
  );
}
