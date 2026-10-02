export type ProjectFormValues = {
  name: string;
  clientId: string;
  leader: string;
  location: string;
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
export type ProjectFormErrors = Partial<Record<'name' | 'area' | 'targetEndDate' | 'stages', string>>;

export function emptyProjectForm(stages: string[]): ProjectFormValues {
  return {
    name: '', clientId: '', leader: 'me', location: '', area: '', contractStartDate: '', startDate: '', targetEndDate: '',
    stages: stages.map((name) => ({ name })), teamIds: [], modelFolderPath: '', description: '',
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

/** The same rules as projects.create (spec 4.4). Only the name is required. */
export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  if (!values.name.trim()) errors.name = 'projectForm.errors.nameRequired';
  const area = areaValue(values.area);
  if (area !== null && !(area >= 0)) errors.area = 'projectForm.errors.areaNumber';
  if (values.startDate && values.targetEndDate && values.targetEndDate <= values.startDate) errors.targetEndDate = 'projectForm.errors.endAfterStart';
  if (values.stages.length === 0) errors.stages = 'projectForm.errors.stageRequired';
  else if (values.stages.some((stage) => !stage.name.trim())) errors.stages = 'projectForm.errors.stageName';
  return errors;
}
