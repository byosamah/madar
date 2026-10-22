import type { ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import { AnimatedIcon, type AnimatedIconComponent } from '../../components/icons/AnimatedIcon';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SwitchButton } from '../../components/Switch';

/**
 * The row parts of the Me hub (Direction D). A row is at least 56 px high, and the whole row is the press area. The icon is plain ink
 * with no coloured tile behind it. A title wraps to a second line and is never cut. A state is a word in ink, not a dot.
 */
type RowBase = {
  icon?: AnimatedIconComponent;
  /** A part that replaces the icon, such as the face of the person. */
  lead?: ReactNode;
  title: string;
  /** Short lines under the title. */
  lines?: string[];
};

const ROW = 'pressable flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start hover:bg-fill/50';

function Lead({ icon, lead }: Pick<RowBase, 'icon' | 'lead'>) {
  if (lead) return <span className="shrink-0">{lead}</span>;
  return icon ? <AnimatedIcon icon={icon} size={20} className="shrink-0 text-ink-2" aria-hidden /> : null;
}

function Lines({ lines, id }: { lines?: string[]; id?: string }) {
  if (!lines || lines.length === 0) return null;
  return (
    <span id={id} className="block">
      {lines.map((line) => <span key={line} className="block break-words text-footnote text-ink-2">{line}</span>)}
    </span>
  );
}

/** A row that opens a page (a link, with a chevron) or runs an action (a button, no chevron). It is an <li>. */
export function MeRow(props: RowBase & ({ to: string; value?: string } | { onPress: () => void; value?: string; buttonRef?: Ref<HTMLButtonElement> })) {
  const body = (
    <>
      <Lead icon={props.icon} lead={props.lead} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-subheadline font-medium text-ink">{props.title}</span>
        <Lines lines={props.lines} />
      </span>
      {props.value && <span className="max-w-[40%] shrink-0 break-words text-end text-footnote text-ink-2">{props.value}</span>}
      {'to' in props && <AnimatedIcon icon={ChevronRightIcon} size={18} className="shrink-0 text-ink-2 rtl:-scale-x-100" aria-hidden />}
    </>
  );
  return (
    <li>
      {'to' in props
        ? <Link to={props.to} className={ROW}>{body}</Link>
        : <button ref={props.buttonRef} type="button" onClick={props.onPress} className={ROW}>{body}</button>}
    </li>
  );
}

/**
 * A row with a switch at the end. The title is the label of the switch, and the lines describe it. `showSwitch={false}` is for a state
 * where the switch cannot work: the row then shows its note and no switch, so the person has no control that does nothing.
 */
export function MeSwitchRow({ id, checked, onChange, note, showSwitch = true, ...base }: RowBase & {
  id: string; checked: boolean; onChange(next: boolean): void; note?: ReactNode; showSwitch?: boolean;
}) {
  const hint = base.lines && base.lines.length > 0 ? `${id}-hint` : undefined;
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      <Lead icon={base.icon} lead={base.lead} />
      <div className="min-w-0 flex-1">
        {showSwitch
          ? <label htmlFor={id} className="block break-words text-subheadline font-medium text-ink">{base.title}</label>
          : <span className="block break-words text-subheadline font-medium text-ink">{base.title}</span>}
        <Lines lines={base.lines} id={hint} />
        {note}
      </div>
      {showSwitch && <SwitchButton id={id} checked={checked} onChange={onChange} describedBy={hint} />}
    </li>
  );
}

/** A row with the title on top and a full-width choice under it. Two Arabic words fit at 360 px only this way. */
export function MeChoiceRow<T extends string>({ icon, title, layoutId, value, options, onChange }: {
  icon?: AnimatedIconComponent; title: string; layoutId: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <span aria-hidden className="flex items-center gap-3 break-words text-subheadline font-medium text-ink">
        {icon && <AnimatedIcon icon={icon} size={20} className="shrink-0 text-ink-2" aria-hidden />}
        {title}
      </span>
      <SegmentedControl fill layoutId={layoutId} label={title} value={value} options={options} onChange={onChange} />
    </li>
  );
}

/** A panel of rows. The hairline sits between the rows. */
export function MePanel({ label, children }: { label?: string; children: ReactNode }) {
  return <ul aria-label={label} className="panel hairline overflow-hidden">{children}</ul>;
}

/** A group word over one or more panels. The group carries the same word as its name for a screen reader. */
export function MeGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-2">
      {title && <p aria-hidden className="px-5 text-footnote font-medium text-ink-2">{title}</p>}
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
