import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import type { SyncChoices } from '../../../api/templateSync';
import { newStoryId } from '../../../app/actions';
import { usePersonName } from '../../../app/personName';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { LoadFailed } from '../../../components/LoadFailed';
import { Sheet } from '../../../components/Sheet';
import { counted } from '../../../lib/grammar';
import { LinkProjectSheet } from './LinkProjectSheet';
import { ChangeCard, DEFAULT_CHOICES, KINDS, changesOf, itemsOf, matchesTemplate, movesDates, type SyncRow } from './SyncSteps';

/** The steps in order: pick the projects, review every change on one screen, and the run. */
type Step = 'pick' | 'review' | 'running';

/** The longest reason that the server keeps (contract limit). */
const REASON_MAX = 280;

/** The most projects that one update takes. The server refuses a plan for more (projectTemplates.syncPlan). */
const MAX_PROJECTS = 50;

/**
 * "Projects using this template" (fbk_008 item 4; ADM-04). The Admin ticks the linked projects. One review screen then names every
 * change with the old and the new value, and each kind has one tick. One reason covers any date move. The main button sends the
 * update. The projects go one after the other under one story, and the toast "Updated 2 projects" has one Undo that takes back every
 * project of the update. With `reviewAll` (the toast "Update them" after a save of the template), the sheet opens at the review
 * with every linked project ticked.
 */
export function TemplateProjectsSheet({ template, onClose, reviewAll = false }: { template: ProjectTemplate; onClose: () => void; reviewAll?: boolean }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const personName = usePersonName();
  const usage = useCall('projectTemplates.usage', { templateId: template.id });
  const users = useCall('users.list', {});
  const [step, setStep] = useState<Step>('pick');
  const [ticked, setTicked] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [linking, setLinking] = useState<string | null>(null);
  const [choices, setChoices] = useState<SyncChoices>(DEFAULT_CHOICES);
  const [reason, setReason] = useState('');
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  // The plan is read while the Admin reviews. A run takes the rows that it had at the press of the main button, so a read that
  // changes during the run does not change the list of projects.
  const plan = useCall('projectTemplates.syncPlan', { templateId: template.id, projectIds: picked }, { enabled: step === 'review' });
  const rows: SyncRow[] = plan.data ?? [];
  const linked = usage.data?.linked ?? [];
  const notLinked = usage.data?.notLinked ?? [];
  const kinds = KINDS.filter((kind) => rows.some((row) => itemsOf(row.diff, kind) > 0));
  const needsReason = rows.some((row) => movesDates(row.diff, choices));
  // Only the projects that change are sent and counted (ADM-19).
  const changing = rows.filter((row) => changesOf(row.diff, choices).length > 0);
  const people = new Set(changing.flatMap((row) => row.diff.people)).size;
  const matches = plan.data !== undefined && rows.every((row) => matchesTemplate(row.diff));
  const projectWord = (n: number) => counted(t, 'projectTemplates.update.projectCount', n);
  const nameOf = (userId: string | null): string => {
    const user = userId === null ? undefined : (users.data ?? []).find((person) => person.id === userId);
    return user ? personName(user) : t('projectTemplates.update.line.noLead');
  };

  const stateOf = (row: { status: string; staleDays: number | null }) => (
    row.staleDays !== null ? t('status.stale', { count: row.staleDays }) : t(`status.${row.status}`)
  );
  // A project past the limit does not get a tick, so the list never holds more than the server takes.
  const toggle = (id: string) => setTicked((list) => {
    if (list.includes(id)) return list.filter((item) => item !== id);
    return list.length >= MAX_PROJECTS ? list : [...list, id];
  });
  const review = (ids: string[]) => {
    setPicked(ids);
    setStep('review');
  };
  const choose = (pick: Partial<SyncChoices>) => setChoices((current) => ({ ...current, ...pick }));

  // The toast "Update them": every linked project is ticked and the sheet goes straight to the review, once.
  const opened = useRef(false);
  useEffect(() => {
    if (!reviewAll || opened.current || usage.data === undefined) return;
    opened.current = true;
    const ids = usage.data.linked.slice(0, MAX_PROJECTS).map((row) => row.project.id);
    if (ids.length === 0) return;
    setTicked(ids);
    setPicked(ids);
    setStep('review');
  }, [reviewAll, usage.data]);

  // One call for each project, one after the other, under one story. A failed project stops the run; the projects before it stay
  // changed, and the Undo of the toast takes them back.
  const run = async () => {
    let storyId = newStoryId();
    let count = 0;
    setTotal(changing.length);
    setDone(0);
    setStep('running');
    const undo = () => {
      api.call('events.undoStory', { correlationId: storyId }).then(
        () => toast.show({ message: t('projectTemplates.update.undone') }),
        (error: unknown) => toast.failed(error),
      );
    };
    for (const row of changing) {
      try {
        const result = await api.run('projectTemplates.syncApply', {
          templateId: template.id,
          projectId: row.project.id,
          choices,
          ...(movesDates(row.diff, choices) ? { dateReason: reason.trim() } : {}),
        }, { correlationId: storyId });
        storyId = result.storyId;
        count += 1;
        setDone(count);
      } catch (error) {
        toast.failed(error);
        if (count > 0) toast.undo(t('projectTemplates.update.stoppedTitle'), undo);
        onClose();
        return;
      }
    }
    toast.undo(t('projectTemplates.update.doneTitle', { projects: projectWord(count) }), undo);
    onClose();
  };

  const title = {
    pick: t('projectTemplates.update.open'),
    review: t('projectTemplates.update.reviewTitle'),
    running: t('projectTemplates.update.runningTitle'),
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
              <Button variant="plain" onClick={() => setTicked(linked.slice(0, MAX_PROJECTS).map((row) => row.project.id))}>{t('projectTemplates.update.all')}</Button>
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
          {linked.length > MAX_PROJECTS && <p className="text-footnote text-ink-2">{t('projectTemplates.update.limit')}</p>}
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

  const reviewBody = (
    <>
      <LoadFailed query={plan} />
      {matches && <p className="text-subheadline text-ink-2">{t(rows.length === 1 ? 'projectTemplates.update.matchesOne' : 'projectTemplates.update.matches')}</p>}
      {plan.data !== undefined && !matches && kinds.map((kind) => (
        <ChangeCard key={kind} kind={kind} rows={rows} choices={choices} onChoose={choose} nameOf={nameOf} />
      ))}
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
          autoComplete="off"
          maxLength={REASON_MAX}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      )}
    </>
  );

  const body = {
    pick: pickBody,
    review: reviewBody,
    running: <p className="text-subheadline text-ink-2">{t('projectTemplates.update.running', { n: Math.min(done + 1, total), total })}</p>,
  }[step];

  // Each footer has a key of its step. A new step makes new buttons, so the focus never stays on the button of the step before.
  const footer = ((): ReactNode => {
    switch (step) {
      case 'pick': return (
        <Fragment key="pick">
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={ticked.length === 0} onClick={() => review(ticked)}>{t('projectTemplates.update.pickNext')}</Button>
        </Fragment>
      );
      case 'review': return matches ? (
        <Fragment key="matches">
          <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
        </Fragment>
      ) : (
        <Fragment key="review">
          <Button variant="plain" onClick={() => setStep('pick')}>{t('projectTemplates.update.back')}</Button>
          <Button
            variant="primary"
            disabled={plan.data === undefined || changing.length === 0 || (needsReason && reason.trim() === '')}
            onClick={() => { void run(); }}
          >
            {t('projectTemplates.update.confirm', { projects: projectWord(changing.length) })}
          </Button>
        </Fragment>
      );
      case 'running': return undefined;
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
