import type { GeoPoint, ProjectTemplate } from '../../api/contract/entities';
import { normalizeTypedCode } from '../../lib/projectCode';
import { emptyCodeValues, typedCodeError, validateCodeValues, type CodeErrors, type CodeProjects, type CodeValues } from './codeForm';
import { planOfForm } from './templateForm';

/** The project template to start from (owner, 2026-10-05, item 6a). templateId '' is no template. See templateForm.ts. */
export type TemplateChoice = { templateId: string; templateRoles: Record<string, string>; templateStretch: Record<string, boolean> };

export function emptyTemplateChoice(): TemplateChoice {
  return { templateId: '', templateRoles: {}, templateStretch: {} };
}

export type ProjectFormValues = CodeValues & TemplateChoice & {
  /** The Admin's correction of the code, in the edit form only (right project.editCode). */
  code: string;
  name: string;
  clientId: string;
  /** The sub-company (fbk_007). Empty is no sub-company. */
  subCompanyId: string;
  leader: string;
  location: string;
  /** The pin on the map (owner, 2026-10-18, fbk_017): null for no pin. */
  geo: GeoPoint | null;
  area: string;
  contractStartDate: string;
  startDate: string;
  targetEndDate: string;
  stages: { id?: string; name: string }[];
  teamIds: string[];
  modelFolderPath: string;
  description: string;
};

/** Each value is a text key, so the form shows the message in the current language. */
/** "template" has no field text: the line under the dates says why the plan does not fit. It only stops the create. */
export type ProjectFormErrors = Partial<Record<'name' | 'area' | 'startDate' | 'targetEndDate' | 'stages' | 'code' | 'template' | 'subCompanyId', string>> & CodeErrors;

/**
 * Which extra rules apply: the code group of a new project, or the Admin's code correction in the edit form. "templates" are the
 * project templates that the new-project form offers, so the form can check the chosen one. "projects" are the codes that a typed
 * code must not take the series of, and "project" is the saved project of the edit form: its own code needs no new check.
 * "subCompanies" is true when the office has sub-companies: a new project then needs one (fbk_007).
 */
export type ProjectFormRules = {
  create?: boolean; editCode?: boolean; templates?: readonly ProjectTemplate[]; projects?: CodeProjects; project?: { id: string; code: string };
  subCompanies?: boolean;
};

export function emptyProjectForm(stages: string[]): ProjectFormValues {
  return {
    name: '', clientId: '', subCompanyId: '', leader: 'me', location: '', geo: null, area: '', contractStartDate: '', startDate: '', targetEndDate: '',
    stages: stages.map((name) => ({ name })), teamIds: [], modelFolderPath: '', description: '', code: '', ...emptyCodeValues(),
    ...emptyTemplateChoice(),
  };
}

/**
 * The area as a number, or null when the field is empty. An Arabic phone keyboard types Arabic-Indic or Persian digits and
 * the Arabic decimal and thousands marks, so those count too (audit PER-16). NaN means "not a number".
 */
export function areaValue(text: string): number | null {
  const western = text.trim()
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.')
    .replace(/[\u066C,]/g, '');
  return western ? Number(western) : null;
}

/** The same rules as projects.create (spec 4.4). A new project also needs its code parts (owner, 2026-10-05). */
export function validateProjectForm(values: ProjectFormValues, rules: ProjectFormRules = {}): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  if (!values.name.trim()) errors.name = 'projectForm.errors.nameRequired';
  const area = areaValue(values.area);
  if (area !== null && !(area >= 0)) errors.area = 'projectForm.errors.areaNumber';
  if (values.startDate && values.targetEndDate && values.targetEndDate <= values.startDate) errors.targetEndDate = 'projectForm.errors.endAfterStart';
  if (values.templateId) {
    // A template gives the stages. It needs a start date, and its locked tasks must fit before the end date.
    const template = rules.templates?.find((t) => t.id === values.templateId);
    if (!values.startDate) errors.startDate = 'templateUse.errors.startRequired';
    else if (template && !errors.targetEndDate && planOfForm(template, values)?.ok === false) errors.template = 'templateUse.tooShort';
  } else if (values.stages.length === 0) errors.stages = 'projectForm.errors.stageRequired';
  else if (values.stages.some((stage) => !stage.name.trim())) errors.stages = 'projectForm.errors.stageName';
  if (rules.create && rules.subCompanies && !values.subCompanyId) errors.subCompanyId = 'subCompanies.required';
  if (rules.create) Object.assign(errors, validateCodeValues(values, rules.projects));
  if (rules.editCode && normalizeTypedCode(values.code) !== rules.project?.code) {
    const error = typedCodeError(values.code, values.codeAnyway, rules.projects ?? [], rules.project?.id ?? null);
    if (error) errors.code = error;
  }
  return errors;
}
