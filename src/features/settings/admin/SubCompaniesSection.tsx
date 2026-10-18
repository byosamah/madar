import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubCompany } from '../../../api/contract/entities';
import { ApiError } from '../../../api/errors';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';
import { Sheet } from '../../../components/Sheet';
import { SubCompanyLogo } from '../../../components/SubCompanyLogo';
import { PictureError, pictureOf } from '../../../lib/picture';

/**
 * The duplicate-name text under a field. The shared reason words (errors.reasons) hold a template text for "duplicate_name",
 * so this sheet keeps its own text for it.
 */
function duplicateText(error: unknown, field: 'name' | 'nameAr', text: string): string | undefined {
  if (!(error instanceof ApiError) || error.details.reason !== 'duplicate_name') return undefined;
  const fields = Array.isArray(error.details.fields) ? (error.details.fields as string[]) : [];
  return fields.includes(field) ? text : undefined;
}

/** Make or change one sub-company: its English name, its Arabic name and its logo. A logo fits inside the circle. */
function SubCompanySheet({ sub, open, onOpenChange }: { sub: SubCompany | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useAction('subCompanies.save', {
    onSuccess: (saved) => {
      toast.show({ message: sub ? t('subCompanies.saved') : t('subCompanies.created', { name: saved.name }) });
      onOpenChange(false);
    },
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setNameEn(sub?.name ?? '');
    setNameAr(sub?.nameAr ?? '');
    setLogo(sub?.logo ?? null);
    setProblem(null);
    // The form starts fresh each time it opens; an old refusal must not stay under a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sub]);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      setLogo(await pictureOf(file, { fit: 'contain' }));
    } catch (failure) {
      setProblem(t(failure instanceof PictureError && failure.reason === 'too_big' ? 'subCompanies.logoTooBig' : 'subCompanies.logoUnreadable'));
    } finally {
      setBusy(false);
      // The same file can be chosen again after a failure.
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const ready = nameEn.trim() !== '' && nameAr.trim() !== '' && !busy && !save.isPending;
  const submit = () => save.mutate({ id: sub?.id, name: nameEn.trim(), nameAr: nameAr.trim(), logo });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={sub ? t('subCompanies.editTitle') : t('subCompanies.add')}
      footer={<Button variant="primary" disabled={!ready} onClick={submit}>{t('admin.save')}</Button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField
          id="sub-company-name"
          label={t('subCompanies.nameEn')}
          value={nameEn}
          dir="auto"
          maxLength={80}
          error={duplicateText(save.error, 'name', t('subCompanies.duplicate'))}
          onChange={(event) => setNameEn(event.target.value)}
        />
        <TextField
          id="sub-company-name-ar"
          label={t('subCompanies.nameAr')}
          value={nameAr}
          dir="auto"
          maxLength={80}
          error={duplicateText(save.error, 'nameAr', t('subCompanies.duplicate'))}
          onChange={(event) => setNameAr(event.target.value)}
        />
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill">
            {logo && <img src={logo} alt="" className="size-full object-contain" />}
          </span>
          <div className="flex min-w-0 flex-col items-start gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              aria-label={t('subCompanies.logo')}
              tabIndex={-1}
              className="sr-only"
              onChange={(event) => void choose(event.target.files?.[0])}
            />
            <Button disabled={busy} onClick={() => fileRef.current?.click()}>{logo ? t('subCompanies.changeLogo') : t('subCompanies.chooseLogo')}</Button>
            <p className="text-footnote text-ink-2">{t('subCompanies.logoHint')}</p>
            {problem && <p role="alert" className="text-footnote text-late">{problem}</p>}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The sub-companies of the office (fbk_007), such as Vado and Bunah. Each project names one. Only the Admin makes and changes them,
 * so this section is open to the Admin alone.
 */
export function SubCompaniesSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const list = useCall('subCompanies.list', {});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SubCompany | null>(null);
  const remove = useUndoable('subCompanies.delete', { message: () => t('subCompanies.deleted') });
  return (
    <section aria-labelledby="admin-sub-companies" className="surface flex flex-col gap-3 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-sub-companies" className="text-headline">{t('subCompanies.title')}</h2>
        <Button onClick={() => setAdding(true)}>
          <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
          {t('subCompanies.add')}
        </Button>
      </div>
      <LoadFailed query={list} />
      {list.data?.length === 0 && <p className="text-footnote text-ink-2">{t('subCompanies.empty')}</p>}
      <ul className="flex flex-col">
        {(list.data ?? []).map((sub) => {
          const shown = lang === 'ar' ? sub.nameAr : sub.name;
          const other = lang === 'ar' ? sub.name : sub.nameAr;
          return (
            <li key={sub.id} className="flex items-center gap-3 py-2">
              <SubCompanyLogo subCompanyId={sub.id} size={28} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold"><bdi>{shown}</bdi></p>
                <p className="text-footnote text-ink-2"><bdi>{other}</bdi></p>
              </div>
              <Menu
                label={t('subCompanies.actions', { name: shown })}
                items={[
                  { label: t('subCompanies.edit'), onSelect: () => setEditing(sub) },
                  { label: t('subCompanies.delete'), onSelect: () => remove.mutate({ id: sub.id }), destructive: true },
                ]}
              />
            </li>
          );
        })}
      </ul>
      <SubCompanySheet sub={null} open={adding} onOpenChange={setAdding} />
      <SubCompanySheet sub={editing} open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} />
    </section>
  );
}
