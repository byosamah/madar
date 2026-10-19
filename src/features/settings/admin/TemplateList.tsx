import { useTranslation } from 'react-i18next';
import { counted } from '../../../lib/grammar';
import { rowsOf, type Picked } from './TemplateGantt';
import type { TemplateDraft } from './templateDraft';

/**
 * The phone form of the template (ADM-06): the same rows as the chart, one line for each stage and each task with its day and length,
 * and no chart. A press on a row picks it, and the editor opens its details in a sheet.
 */
export function TemplateList({ draft, onSelect }: { draft: TemplateDraft; onSelect: (part: Picked) => void }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col">
      {rowsOf(draft).map((row) => (
        <li key={row.id} className={row.kind === 'stage' ? 'border-t border-separator first:border-t-0' : undefined}>
          <button
            type="button"
            onClick={() => onSelect({ kind: row.kind, id: row.id })}
            className={`pressable flex min-h-11 w-full flex-col justify-center rounded-lg py-1 pe-2 text-start hover:bg-fill ${row.kind === 'stage' ? 'ps-2' : 'ps-6'}`}
          >
            <bdi className={`truncate text-subheadline ${row.kind === 'stage' ? 'font-semibold text-ink' : 'text-ink'}`}>{row.label}</bdi>
            {row.bar && (
              <span className="tabular text-footnote text-ink-2">
                {t('projectTemplates.rowMeta', { start: row.bar.start, days: counted(t, 'projectTemplates.dayCount', row.bar.length) })}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
