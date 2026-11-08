import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { PictureError, pictureOf } from '../../lib/picture';
import { FormError } from '../../components/FormError';
import { EnterpriseLogo } from './EnterpriseLogo';

/**
 * The logo of an enterprise: one picture that fits inside a round plate, as the logo of a sub-company does (pictureOf with fit contain).
 * The picture becomes a small data address in the page, so no file store holds it. One button, one hint, and a calm line for a picture that
 * is too big or unreadable. With no picture, the circle shows the first letter of `name`.
 */
export function LogoPicker({ id, value, onChange, label, name = '' }: { id: string; value: string | null; onChange: (logo: string | null) => void; label: string; name?: string }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      onChange(await pictureOf(file, { fit: 'contain' }));
    } catch (failure) {
      setProblem(t(failure instanceof PictureError && failure.reason === 'too_big' ? 'subCompanies.logoTooBig' : 'subCompanies.logoUnreadable'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-4">
      <EnterpriseLogo logo={value} name={name} size={56} />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <input
          ref={fileRef}
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          aria-label={label}
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>{value ? t('subCompanies.changeLogo') : t('subCompanies.chooseLogo')}</Button>
        <p className="text-footnote text-ink-2">{t('enterprises.logoHint')}</p>
        <FormError text={problem} />
      </div>
    </div>
  );
}
