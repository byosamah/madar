import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The main sheets that the owner counts (insight design, section 4). A sheet that drops its hook stops being counted: this test says so. */
const SHEETS: { file: string; name: string }[] = [
  { file: 'src/features/projects/NewProjectSheet.tsx', name: 'newProject' },
  { file: 'src/features/project/tasks/NewTaskSheet.tsx', name: 'newTask' },
  { file: 'src/features/search/NewTaskSheet.tsx', name: 'newTask' },
  { file: 'src/features/work/NewOfficeTaskSheet.tsx', name: 'newOfficeTask' },
  { file: 'src/features/project/payments/PaymentSheet.tsx', name: 'payment' },
  { file: 'src/features/meetings/MeetingForm.tsx', name: 'meeting' },
  { file: 'src/features/project/tracker/QuickLog.tsx', name: 'trackerLog' },
  { file: 'src/features/feedback/FeedbackSheet.tsx', name: 'feedback' },
];

describe('the counted sheets', () => {
  it.each(SHEETS)('$file counts the open, the save and the close of $name', ({ file, name }) => {
    const text = readFileSync(file, 'utf8');
    expect(text).toContain(`useSheetSteps('${name}',`);
    expect(text).toMatch(/stepSaved\(\)/);
  });
});
