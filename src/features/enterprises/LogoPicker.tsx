import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { LOGO_PLATE } from '../../components/SubCompanyLogo';
import { PictureError, pictureOf } from '../../lib/picture';
import { FormError } from '../auth/AuthPage';

/**
 * The logo of an enterprise: one picture that fits inside a round plate, as the logo of a sub-company does (pictureOf with fit contain).
 * The picture becomes a small data address in the page, so no file store holds it. One button, one hint, and a calm line for a picture that
 * is too big or unreadable.
 */
export function LogoPicker({ id, value, onChange, label }: { id: string; value: string | null; onChange: (logo: string | null) => void; label: string }) {
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
      <span style={{ background: value ? LOGO_PLATE : undefined }} className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill">
        {value && <img src={value} alt="" className="size-full object-contain" />}
      </span>
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
