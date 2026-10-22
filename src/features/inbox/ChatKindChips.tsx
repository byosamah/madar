import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { arrowStep } from '../../lib/keys';
import { KINDS, type ChatKind } from './chatKinds';

/**
 * The four kinds of chat as chips, on a phone (Direction D). They replace the menu of the desk. The row wraps, so a long word never
 * pushes a chip out of the screen. The group is one Tab stop and the arrow keys move the choice, as in the other radio groups. The open
 * chip is a white card, never navy: navy stays on the one main action of a screen. `ChatList` owns the choice.
 */
export function ChatKindChips({ kind, onChange }: { kind: ChatKind; onChange: (kind: ChatKind) => void }) {
  const { t } = useTranslation();
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event.key, document.documentElement.dir === 'rtl', true);
    if (step === 0) return;
    event.preventDefault();
    const index = (KINDS.indexOf(kind) + step + KINDS.length) % KINDS.length;
    onChange(KINDS[index]);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label={t('chatFilter.group')} onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
      {KINDS.map((value) => {
        const checked = value === kind;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(value)}
            className={`pressable inline-flex min-h-11 items-center rounded-full px-4 text-subheadline font-medium ${checked ? 'bg-card text-ink shadow-card' : 'bg-fill text-ink-2 transition-colors hover:text-ink'}`}
          >
            {t(`chatFilter.${value}`)}
          </button>
        );
      })}
    </div>
  );
}
