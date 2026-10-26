import { ProjectTile } from '../../components/ProjectTile';
import { SignGlyph } from '../../components/StatusSign';

/** The state of a project that shows on its pin. On track shows nothing, as in every list of Madar. */
export type PinSign = 'at_risk' | 'late';

/**
 * The pin of a project on the Dashboard map (owner, 2026-10-19, PRJ-14): the project's own picture tile with a light ring, so a
 * person knows the project without a press. A late or at-risk project carries the status shape at the top end corner (the shape
 * and the color, as DESIGN.md says: red only for Late). The press box of 44 px comes from MapCanvas. The chosen pin has an accent ring.
 */
export function ProjectPin({ id, mark, shape, subCompanyId, sign, selected }: { id: string; mark?: number; shape?: string | null; subCompanyId: string | null; sign: PinSign | null; selected: boolean }) {
  const ring = selected ? 'var(--c-accent)' : 'var(--c-card)';
  return (
    <span className="relative grid place-items-center">
      <span
        className="grid rounded-[30%]"
        style={{ boxShadow: `0 0 0 ${selected ? 3 : 2.5}px ${ring}, 0 0 0 4px color-mix(in srgb, var(--c-ink-2) 55%, transparent), 0 3px 10px rgba(0, 0, 0, 0.3)` }}
      >
        <ProjectTile id={id} mark={mark} shape={shape} size={32} subCompanyId={subCompanyId} />
      </span>
      {sign && (
        <span data-pin-sign={sign} className="absolute -top-1.5 grid size-[18px] place-items-center rounded-full bg-card shadow-md -end-1.5">
          <SignGlyph state={sign} />
        </span>
      )}
    </span>
  );
}
