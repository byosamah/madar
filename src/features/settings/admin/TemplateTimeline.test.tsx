import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TemplateTimeline } from './TemplateTimeline';
import type { TemplateDraft } from './templateDraft';

/** One stage with its own start (day 0) and 20 days, and one locked task inside it (day 2, 4 days). */
const DRAFT: TemplateDraft = {
  name: 'Villa',
  roles: [],
  stages: [{ id: 's1', name: 'Concept', start: '0', days: '20' }],
  tasks: [{
    id: 't1', stageId: 's1', title: 'Massing', roleId: '', start: '2', days: '4', flexible: false,
    description: '', checklist: [], needsReview: false,
  }],
};

describe('the template timeline', () => {
  it('draws the stage bar under the task bars, and the locked task bar stays visible', () => {
    const { container } = render(<TemplateTimeline draft={DRAFT} />);
    const bars = [...container.querySelectorAll<HTMLElement>('li > span.relative > span')];
    expect(bars).toHaveLength(2);
    const [stageBar, taskBar] = bars;
    // The stage bar comes first in the row, so the later task bar paints on top of it.
    expect(stageBar).toHaveClass('bg-chart-muted', 'opacity-40');
    expect(taskBar).toHaveClass('bg-ink');
    expect(taskBar).not.toHaveClass('opacity-40');
  });
});
