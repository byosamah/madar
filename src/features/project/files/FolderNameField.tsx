import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** The longest folder name. The contract holds the same number (FOLDER_NAME_MAX in entities.ts); a test compares them, so this file loads no zod. */
export const FOLDER_NAME_LIMIT = 60;

/**
 * The one name field of a folder (fbk_066): for a new folder and for a rename. Enter or a blur with text saves. Escape, or a blur with no text
 * (or with the same name), cancels. It takes the focus when it shows. The name goes to the call as it stands: the call trims it and refuses a
 * name that the stage already has, and the refusal shows as a toast.
 */
export function FolderNameField({ initial = '', onSave, onCancel }: { initial?: string; onSave: (name: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  // Enter saves and the field then goes, which blurs it: one save only.
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (save && name !== '' && name !== initial.trim()) onSave(name);
    else onCancel();
  };
  return (
    <input
      autoFocus
      type="text"
      dir="auto"
      value={value}
      maxLength={FOLDER_NAME_LIMIT}
      aria-label={t('folders.nameLabel')}
      placeholder={t('folders.namePlaceholder')}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className="min-h-11 min-w-0 flex-1 rounded-xl border border-hairline bg-panel px-3 text-body text-ink outline-none focus-visible:border-accent"
    />
  );
}
