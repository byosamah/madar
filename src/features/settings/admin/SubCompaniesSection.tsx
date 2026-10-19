import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SubCompany } from '../../../api/contract/entities';
import { ApiError } from '../../../api/errors';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { LoadFailed } from '../../../components/LoadFailed';
import { Menu } from '../../../components/Menu';
import { Sheet } from '../../../components/Sheet';
import { LOGO_PLATE, SubCompanyLogo } from '../../../components/SubCompanyLogo';
import { counted } from '../../../lib/grammar';
import { DEFAULT_CROP, PictureError, pictureOf, type PictureCrop } from '../../../lib/picture';
import { LogoFrame } from './LogoFrame';

/** A sub-company with the number of projects that name it (subCompanies.list). */
type Row = SubCompany & { projectCount?: number };

/** The place where the Projects list shows the projects of one sub-company. */
const projectsOf = (id: string) => `/projects?subCompany=${id}`;

/** The wait before a change of the frame makes the picture again, so a drag does not make one picture for each pixel. */
const FRAME_DELAY_MS = 250;

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
  const framed = useRef(false);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The file just chosen, and the frame the Admin set on it. The frame step shows only for a new file (PRJ-11).
  const [source, setSource] = useState<File | null>(null);
  const [crop, setCrop] = useState<PictureCrop>(DEFAULT_CROP);
  const [framing, setFraming] = useState(false);
  // The name that Save found empty. The message goes when the person writes it (PRJ-16).
  const [missing, setMissing] = useState<'en' | 'ar' | null>(null);
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
    setSource(null);
    setCrop(DEFAULT_CROP);
    setFraming(false);
    setMissing(null);
    framed.current = false;
    // The form starts fresh each time it opens; an old refusal must not stay under a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sub]);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      setLogo(await pictureOf(file, { fit: 'contain' }));
      setSource(file);
      setCrop(DEFAULT_CROP);
      setFraming(false);
    } catch (failure) {
      setProblem(t(failure instanceof PictureError && failure.reason === 'too_big' ? 'subCompanies.logoTooBig' : 'subCompanies.logoUnreadable'));
    } finally {
      setBusy(false);
      // The same file can be chosen again after a failure.
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  // A change of the frame makes the picture again after a short wait. Save waits for it.
  const changeCrop = (next: PictureCrop) => {
    framed.current = true;
    setFraming(true);
    setCrop(next);
  };
  useEffect(() => {
    if (!source || !framed.current) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      void pictureOf(source, { fit: 'contain', crop })
        .then((made) => { if (current) setLogo(made); })
        .catch((failure: unknown) => {
          if (current) setProblem(t(failure instanceof PictureError && failure.reason === 'too_big' ? 'subCompanies.logoTooBig' : 'subCompanies.logoUnreadable'));
        })
        .finally(() => { if (current) setFraming(false); });
    }, FRAME_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [source, crop, t]);
  const ready = !busy && !framing && !save.isPending;
  // Save is always on. An empty name gets its message and the focus, one name at a time.
  const submit = () => {
    const first = nameEn.trim() === '' ? 'en' : nameAr.trim() === '' ? 'ar' : null;
    setMissing(first);
    if (first) {
      document.getElementById(first === 'en' ? 'sub-company-name' : 'sub-company-name-ar')?.focus();
      return;
    }
    save.mutate({ id: sub?.id, name: nameEn.trim(), nameAr: nameAr.trim(), logo });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={sub ? t('subCompanies.editTitle') : t('subCompanies.add')}
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>{t('admin.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField
          id="sub-company-name"
          label={t('subCompanies.nameEn')}
          value={nameEn}
          dir="auto"
          maxLength={80}
          required
          autoComplete="off"
          error={duplicateText(save.error, 'name', t('subCompanies.duplicate')) ?? (missing === 'en' && nameEn.trim() === '' ? t('subCompanies.nameEnRequired') : undefined)}
          onChange={(event) => setNameEn(event.target.value)}
        />
        <TextField
          id="sub-company-name-ar"
          label={t('subCompanies.nameAr')}
          value={nameAr}
          dir="auto"
          maxLength={80}
          required
          autoComplete="off"
          error={duplicateText(save.error, 'nameAr', t('subCompanies.duplicate')) ?? (missing === 'ar' && nameAr.trim() === '' ? t('subCompanies.nameArRequired') : undefined)}
          onChange={(event) => setNameAr(event.target.value)}
        />
        <div className="flex items-center gap-4">
          {/* The same white plate as everywhere (PRJ-10). */}
          <span style={{ background: logo ? LOGO_PLATE : undefined }} className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill">
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
        {source && <LogoFrame file={source} crop={crop} onCrop={changeCrop} />}
      </div>
    </Sheet>
  );
}

/**
 * The question before the delete of a sub-company that projects name (PRJ-12): where do the projects go? One call moves them and
 * deletes the sub-company in one story, so one Undo takes it all back. The default is another sub-company, else none.
 */
function MoveSheet({ sub, others, onClose }: { sub: Row; others: Row[]; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const shown = lang === 'ar' ? sub.nameAr : sub.name;
  const [target, setTarget] = useState(others[0]?.id ?? NONE);
  const remove = useUndoable('subCompanies.delete', { message: () => t('subCompanies.movedAndDeleted'), onSuccess: onClose });
  const count = sub.projectCount ?? 0;
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('subCompanies.deleteTitle', { name: shown })}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={remove.isPending} onClick={() => remove.mutate({ id: sub.id, moveToId: target === NONE ? null : target })}>
            {t('subCompanies.moveAndDelete')}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <p className="text-body text-ink">{counted(t, 'subCompanies.moveBody', count)}</p>
        <SelectField id="sub-company-move" label={t('subCompanies.moveTo')} value={target} onChange={(event) => setTarget(event.target.value)}>
          {others.map((other) => <option key={other.id} value={other.id}>{lang === 'ar' ? other.nameAr : other.name}</option>)}
          <option value={NONE}>{t('subCompanies.none')}</option>
        </SelectField>
        <p className="text-footnote text-ink-2">{t('subCompanies.moveBodyHint')}</p>
        <Link to={projectsOf(sub.id)} className="inline-flex min-h-11 items-center self-start text-subheadline font-semibold text-link hover:underline">{t('subCompanies.showProjects')}</Link>
      </div>
    </Sheet>
  );
}

/** The value of the "no sub-company" choice in the move list. */
const NONE = 'none';

/**
 * The sub-companies of the office (fbk_007), such as Vado and Bunah. Each project names one. Only the Admin makes and changes them,
 * so this section is open to the Admin alone. A row shows how many projects name the sub-company, as a link to those projects.
 */
export function SubCompaniesSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const list = useCall('subCompanies.list', {});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SubCompany | null>(null);
  const [moving, setMoving] = useState<Row | null>(null);
  const remove = useUndoable('subCompanies.delete', { message: () => t('subCompanies.deleted') });
  const rows: Row[] = list.data ?? [];
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
        {rows.map((sub) => {
          const shown = lang === 'ar' ? sub.nameAr : sub.name;
          const other = lang === 'ar' ? sub.name : sub.nameAr;
          const count = sub.projectCount ?? 0;
          return (
            <li key={sub.id} className="flex items-center gap-3 py-2">
              <SubCompanyLogo subCompanyId={sub.id} size={28} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold"><bdi>{shown}</bdi></p>
                <p className="text-footnote text-ink-2"><bdi>{other}</bdi></p>
              </div>
              {count > 0
                ? <Link to={projectsOf(sub.id)} className="inline-flex min-h-11 shrink-0 items-center px-1 text-footnote font-semibold text-link hover:underline">{counted(t, 'subCompanies.projectCount', count)}</Link>
                : <span className="shrink-0 px-1 text-footnote text-ink-2">{t('subCompanies.noProjects')}</span>}
              <Menu
                label={t('subCompanies.actions', { name: shown })}
                items={[
                  { label: t('subCompanies.edit'), onSelect: () => setEditing(sub) },
                  { label: t('subCompanies.delete'), onSelect: () => (count > 0 ? setMoving(sub) : remove.mutate({ id: sub.id })), destructive: true },
                ]}
              />
            </li>
          );
        })}
      </ul>
      <SubCompanySheet sub={null} open={adding} onOpenChange={setAdding} />
      <SubCompanySheet sub={editing} open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} />
      {moving && <MoveSheet sub={moving} others={rows.filter((item) => item.id !== moving.id)} onClose={() => setMoving(null)} />}
    </section>
  );
}
