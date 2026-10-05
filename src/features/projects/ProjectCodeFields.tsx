import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client } from '../../api/contract/entities';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { SelectField, TextField } from '../../components/Fields';
import { todayISO } from '../../lib/dates';
import {
  CLASSIFICATIONS, codeMonth, nextSeries, normalizeInitials, projectKey, TYPE_MAX, type Classification,
} from '../../lib/projectCode';
import { codePreview, upperCodeHead, type CodeErrors, type CodeMode } from './codeForm';
import type { ProjectForm } from './ProjectFields';

/** The examples in the hints. They are code, so they stay in Latin letters in both languages. */
const EXAMPLES = { initials: 'AZT', type: 'Villa, Multi-unit Dev.', code: '260902AZT-RES-Villa' };

/**
 * The "Project code" group of the new-project form (owner, 2026-10-05, item 6b): the client initials (from the client and
 * locked when the client has them), the class and the building type, with a live preview of the full code. Two quiet links
 * open the other ways: a full code typed by hand, or the code of another project of the same contract.
 */
export function ProjectCodeFields({ form, clients }: { form: ProjectForm; clients: Client[] }) {
  const { t } = useTranslation();
  const list = useCall('projects.list', { status: 'all' });
  const { values, errors, set, touch } = form;
  const client = clients.find((item) => item.id === values.clientId);
  const locked = client?.initials ?? '';

  // A new client choice brings its initials, or an empty field. A client list that arrives late fills locked initials.
  const seenClient = useRef(values.clientId);
  useEffect(() => {
    if (seenClient.current !== values.clientId) {
      seenClient.current = values.clientId;
      set('initials', locked);
    } else if (locked && values.initials !== locked) {
      set('initials', locked);
    }
    // "set" is a new function on each render; the client and its initials decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.clientId, locked]);

  const projects = [...(list.data ?? [])].sort((a, b) => a.project.name.localeCompare(b.project.name));
  const yymm = codeMonth(todayISO());
  const series = nextSeries(projects.map((summary) => summary.project.code), yymm);
  const sameCode = projects.find((summary) => summary.project.id === values.sameAs)?.project.code ?? null;
  const preview = codePreview(values, { yymm, series, sameCode });
  const message = (field: keyof CodeErrors) => (errors[field] ? t(errors[field] as string, { example: EXAMPLES.code }) : undefined);
  const open = (mode: CodeMode) => set('codeMode', mode);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="pb-2 text-subheadline font-semibold text-ink">{t('projectCode.group')}</legend>
      {values.codeMode === 'parts' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="code-initials" label={t('projectCode.initials')} required dir="ltr" maxLength={4} autoComplete="off" autoCapitalize="characters"
            readOnly={locked !== ''} value={locked || values.initials}
            hint={locked ? t('projectCode.initialsFromClient') : client ? t('projectCode.initialsToClient') : t('clientForm.initialsHint', { example: EXAMPLES.initials })}
            onChange={(event) => set('initials', normalizeInitials(event.target.value))}
            onBlur={() => touch('initials')} error={message('initials')}
          />
          <SelectField
            id="code-class" label={t('projectCode.classification')} required value={values.classification}
            onChange={(event) => set('classification', event.target.value as Classification | '')}
            onBlur={() => touch('classification')} error={message('classification')}
          >
            <option value="">{t('projectCode.choose')}</option>
            {CLASSIFICATIONS.map((cls) => <option key={cls} value={cls}>{`${cls} · ${t(`projectCode.classes.${cls}`)}`}</option>)}
          </SelectField>
          <TextField
            id="code-type" className="sm:col-span-2" label={t('projectCode.type')} required dir="auto" maxLength={TYPE_MAX} autoComplete="off"
            hint={t('projectCode.typeHint', { example: EXAMPLES.type })} value={values.buildingType}
            onChange={(event) => set('buildingType', event.target.value)} onBlur={() => touch('buildingType')} error={message('buildingType')}
          />
        </div>
      )}
      {values.codeMode === 'typed' && (
        <TextField
          id="code-full" label={t('projectCode.full')} required dir="ltr" autoComplete="off" autoCapitalize="characters"
          hint={t('projectCode.fullHint', { example: EXAMPLES.code })} value={values.typedCode}
          onChange={(event) => set('typedCode', upperCodeHead(event.target.value))} onBlur={() => touch('typedCode')} error={message('typedCode')}
        />
      )}
      {values.codeMode === 'same' && (
        <SelectField
          id="code-same" label={t('projectCode.sameAs')} required value={values.sameAs}
          onChange={(event) => set('sameAs', event.target.value)} onBlur={() => touch('sameAs')} error={message('sameAs')}
        >
          <option value="">{t('projectCode.chooseProject')}</option>
          {projects.map((summary) => (
            <option key={summary.project.id} value={summary.project.id}>{`${projectKey(summary.project.code)} · ${summary.project.name}`}</option>
          ))}
        </SelectField>
      )}
      {preview && (
        <dl className="flex flex-col gap-0.5">
          <dt className="field-label">{t('projectCode.preview')}</dt>
          <dd dir="ltr" className={`tabular break-all text-body font-semibold ${preview.complete ? 'text-ink' : 'text-ink-2'}`}>{preview.text}</dd>
        </dl>
      )}
      <div className="-ms-3 flex flex-wrap">
        {values.codeMode === 'parts' ? (
          <>
            <Button variant="plain" className="px-3" onClick={() => open('typed')}>{t('projectCode.typeByHand')}</Button>
            <Button variant="plain" className="px-3" onClick={() => open('same')}>{t('projectCode.sameContract')}</Button>
          </>
        ) : (
          <Button variant="plain" className="px-3" onClick={() => open('parts')}>{t('projectCode.useParts')}</Button>
        )}
      </div>
    </fieldset>
  );
}
