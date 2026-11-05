import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileView } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';

/** The longest file name. The contract holds the same number (FileRec.name in entities.ts). */
const FILE_NAME_LIMIT = 200;

/** The name of a file of Resources (fbk_078). One field and one main button. The call trims the name; an empty name or the same name changes nothing. */
export function RenameFileSheet({ view, onSave, onClose }: { view: FileView; onSave: (name: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(view.file.name);
  const name = value.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name !== '' && name !== view.file.name) onSave(name);
    onClose();
  };
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={t('resources.renameTitle', { name: view.file.name })}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField id="resource-file-name" label={t('resources.fileName')} value={value} maxLength={FILE_NAME_LIMIT} dir="auto" autoFocus onChange={(event) => setValue(event.target.value)} />
        <Button type="submit" variant="primary" disabled={name === '' || name === view.file.name}>{t('resources.rename')}</Button>
      </form>
    </Sheet>
  );
}
