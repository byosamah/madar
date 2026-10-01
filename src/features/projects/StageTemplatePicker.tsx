import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField, TextField } from '../../components/Fields';
import type { ProjectFormValues } from './projectForm';

type Stages = ProjectFormValues['stages'];

/** A stage that keeps its name keeps its id, so its tasks and dates stay with it when a project takes a new list. */
export function applyNames(names: string[], current: Stages): Stages {
  const free = [...current];
  return names.map((name) => {
    const at = free.findIndex((stage) => stage.id && stage.name.trim().toLowerCase() === name.toLowerCase());
    if (at === -1) return { name };
    const [kept] = free.splice(at, 1);
    return { id: kept.id, name };
  });
}

/**
 * Two quiet controls above the stage list: "Start from" fills the list from the office defaults or a saved template,
 * and "Save as template" keeps the current list for later. The name form opens inline, because a sheet inside a sheet would close the form.
 */
export function StageTemplatePicker({ stages, onChange, mode }: { stages: Stages; onChange: (stages: Stages) => void; mode: 'create' | 'edit' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useCall('settings.get', {});
  const templates = useCall('stageTemplates.list', {});
  const [source, setSource] = useState(mode === 'create' ? 'default' : '');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const save = useAction('stageTemplates.save', {
    onSuccess: (template) => {
      setSource(template.id);
      setNaming(false);
      setName('');
      toast.show({ message: t('stageTemplates.saved') });
    },
  });

  const choose = (value: string) => {
    setSource(value);
    if (value === 'default') onChange(applyNames(settings.data?.defaultStages ?? [], stages));
    else if (value) {
      const template = templates.data?.find((row) => row.id === value);
      if (template) onChange(applyNames(template.stages, stages));
    }
  };
  const submit = () => {
    const names = stages.map((stage) => stage.name.trim());
    if (names.length === 0 || names.some((stageName) => !stageName)) {
      toast.show({ tone: 'error', message: t('projectForm.errors.stageName') });
      return;
    }
    save.mutate({ name: name.trim(), stages: names });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <SelectField id="stage-start-from" className="flex-1" label={t('stageTemplates.startFrom')} value={source} onChange={(event) => choose(event.target.value)}>
          {mode === 'edit' && <option value="">{t('stageTemplates.current')}</option>}
          <option value="default">{t('stageTemplates.officeDefault')}</option>
          {(templates.data ?? []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </SelectField>
        <Button variant="plain" aria-expanded={naming} onClick={() => setNaming((open) => !open)}>{t('stageTemplates.saveAs')}</Button>
      </div>
      {naming && (
        <div className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
          <TextField
            id="stage-template-name"
            label={t('stageTemplates.name')}
            value={name}
            dir="auto"
            maxLength={60}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Enter must not send the project form that holds this field.
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (name.trim() && !save.isPending) submit();
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!name.trim() || save.isPending} onClick={submit}>{t('stageTemplates.saveTemplate')}</Button>
            <Button variant="plain" onClick={() => setNaming(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
