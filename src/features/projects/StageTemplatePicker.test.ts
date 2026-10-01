import { describe, expect, it } from 'vitest';
import { applyNames } from './StageTemplatePicker';

describe('applyNames', () => {
  it('keeps the id of a stage whose name stays, so its tasks stay with it', () => {
    const current = [{ id: 'stg_001', name: 'Concept' }, { id: 'stg_002', name: 'Permits' }];
    expect(applyNames(['Brief', 'concept'], current)).toEqual([{ name: 'Brief' }, { id: 'stg_001', name: 'concept' }]);
  });

  it('gives each id to one stage only', () => {
    expect(applyNames(['Concept', 'Concept'], [{ id: 'stg_001', name: 'Concept' }])).toEqual([{ id: 'stg_001', name: 'Concept' }, { name: 'Concept' }]);
  });

  it('gives a new list with no ids when the project has none yet', () => {
    expect(applyNames(['A', 'B'], [{ name: 'A' }])).toEqual([{ name: 'A' }, { name: 'B' }]);
  });
});
