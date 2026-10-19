import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { editedBody, plainText } from '../../lib/text';
import { useBubbleActions } from './bubbleActions';
import type { Bubble } from './MessageBubble';

/**
 * The edit of a message in place of its words (chat design 2026-10-19, item 11). The field shows the names as "@Name" and takes the
 * focus; a plain Enter saves, Escape cancels, and Cancel and Save sit under it. Save is a secondary button: the Send button of the box
 * stays the one main button. The names the old words held stay, also for a person who left (`editedBody`).
 */
export function MessageEditForm({ bubble }: { bubble: Bubble }) {
  const { t } = useTranslation();
  const actions = useBubbleActions();
  const [draft, setDraft] = useState(() => plainText(bubble.body));
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const box = field.current;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, []);
  if (!actions) return null;
  const save = () => {
    if (!draft.trim()) return;
    actions.saveEdit(bubble, editedBody(draft.trim(), actions.people, bubble.body));
  };
  return (
    <form
      className="flex w-[min(22rem,70vw)] max-w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div
        onKeyDown={(event) => {
          // The mention list takes its own Enter and Escape first and marks the event.
          if (event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            actions.endEdit();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
        }}
      >
        <MentionField id={`edit-${bubble.id}`} label={t('comments.edit')} value={draft} onChange={setDraft} people={actions.people} rows={2} inputRef={field} placement="above" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="plain" onClick={actions.endEdit}>{t('common.cancel')}</Button>
        <Button variant="secondary" type="submit" disabled={!draft.trim()}>{t('comments.save')}</Button>
      </div>
    </form>
  );
}
