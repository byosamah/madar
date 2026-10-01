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

/** The same rules as projects.create (spec 4.4). Only the name is required. */
export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  if (!values.name.trim()) errors.name = 'projectForm.errors.nameRequired';
  if (values.area.trim() && !(Number(values.area) >= 0)) errors.area = 'projectForm.errors.areaNumber';
  if (values.startDate && values.targetEndDate && values.targetEndDate <= values.startDate) errors.targetEndDate = 'projectForm.errors.endAfterStart';
  if (values.stages.length === 0) errors.stages = 'projectForm.errors.stageRequired';
  else if (values.stages.some((stage) => !stage.name.trim())) errors.stages = 'projectForm.errors.stageName';
  return errors;
}
