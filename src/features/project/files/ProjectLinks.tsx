import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNetworkPath, LinkKind, linkUrlOk, type ProjectLink } from '../../../api/contract/entities';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { fieldError } from '../../../app/errors';
import { useLang } from '../../../app/lang';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { AnimatedIcon, type AnimatedIconComponent } from '../../../components/icons/AnimatedIcon';
import { CopyIcon } from '../../../components/icons/animated/copy';
import { ExternalLinkIcon } from '../../../components/icons/animated/external-link';
import { FolderOpenIcon } from '../../../components/icons/animated/folder-open';
import { LinkIcon } from '../../../components/icons/animated/link';
import { MapPinIcon } from '../../../components/icons/animated/map-pin';
import { PaletteIcon } from '../../../components/icons/animated/palette';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { SendIcon } from '../../../components/icons/animated/send';
import { SquarePenIcon } from '../../../components/icons/animated/square-pen';
import { Sheet } from '../../../components/Sheet';
import { pinFromLinks, samePoint } from '../../../lib/geo';
import { addressOf } from '../../../lib/placeAddress';

const KINDS = LinkKind.options;
const ICON: Record<LinkKind, AnimatedIconComponent> = { moodboard: PaletteIcon, folder: FolderOpenIcon, location: MapPinIcon, delivery: SendIcon, other: LinkIcon };
// The model folder of the project form shows as the first office folder, so nobody keeps the same path twice.
const MODEL_FOLDER = 'model-folder';

/** "pinterest.com" for a web link with no name. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The path as a read-only field, selected, for a person who copies it by hand. */
function PathField({ path, onDone }: { path: string; onDone: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return <input ref={ref} readOnly dir="ltr" aria-label={t('links.pathLabel')} value={path} onBlur={onDone} className="field min-h-11 basis-full" />;
}

function LinkSheet({ detail, link, open, onOpenChange }: { detail: ProjectDetail; link: ProjectLink | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<LinkKind>('moodboard');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const lang = useLang();
  const [looking, setLooking] = useState(false);
  // The number of the last press or opening: the answer of a lookup that comes after a close is dropped.
  const turn = useRef(0);
  useEffect(() => {
    turn.current += 1;
    setLooking(false);
    if (!open) return;
    setKind(link?.kind ?? 'moodboard');
    setLabel(link?.label ?? '');
    setUrl(link?.url ?? '');
  }, [open, link]);
  const close = () => onOpenChange(false);
  const add = useUndoable('projects.addLink', { message: () => t('links.added'), onSuccess: close });
  const save = useUndoable('projects.updateLink', { message: () => t('links.saved'), onSuccess: close });
  const remove = useUndoable('projects.removeLink', { message: () => t('links.removed'), onSuccess: close });
  const busy = add.isPending || save.isPending || remove.isPending || looking;
  const error = fieldError(link ? save.error : add.error, 'url', t, t(kind === 'folder' ? 'links.badFolder' : 'links.badWeb', { scheme: 'https://', path: '\\\\SERVER\\folder' }));
  const submit = async () => {
    const fields = { projectId: detail.project.id, kind, label: label.trim(), url: url.trim() };
    // A location link that holds a point moves the pin, and the Location is the address of the pin (owner, 2026-10-19). The screen
    // looks up the address of the new place first and sends it with the link, so the link, the pin and the address are one write
    // and one Undo. A link that moves nothing sends no address, and a person who may not move the pin asks for no lookup.
    const place = kind === 'location' && detail.viewerCan.edit ? pinFromLinks([{ kind, url: fields.url }]) : null;
    let address: { location?: string } = {};
    if (place && !samePoint(place, detail.geo)) {
      const mine = ++turn.current;
      setLooking(true);
      const location = await addressOf(place, lang);
      if (mine !== turn.current) return;
      setLooking(false);
      address = { location };
    }
    if (link) save.mutate({ ...fields, ...address, linkId: link.id });
    else add.mutate({ ...fields, ...address });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={link ? t('links.editTitle') : t('links.addTitle')}
      description={t('links.hint')}
      footer={(
        <>
          {link && <Button variant="destructive" className="me-auto" disabled={busy} onClick={() => remove.mutate({ projectId: detail.project.id, linkId: link.id })}>{t('links.remove')}</Button>}
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!url.trim() || busy} onClick={() => void submit()}>{link ? t('links.save') : t('links.add')}</Button>
        </>
      )}
    >
      <form className="flex flex-col gap-4 pt-1" autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (url.trim() && !busy) void submit(); }}>
        <SelectField id="link-kind" label={t('links.kind')} value={kind} onChange={(event) => setKind(event.target.value as LinkKind)}>
          {KINDS.map((value) => <option key={value} value={value}>{t(`links.kinds.${value}`)}</option>)}
        </SelectField>
        <TextField id="link-label" label={t('links.name')} hint={t('links.nameHint', { example: 'Pinterest: facades' })} autoComplete="off" value={label} maxLength={80} dir="auto" onChange={(event) => setLabel(event.target.value)} />
        <TextField
          id="link-url"
          label={t('links.url')}
          value={url}
          dir="ltr"
          inputMode="url"
          autoComplete="off"
          placeholder={kind === 'folder' ? '\\\\STUDIO\\Projects\\…' : 'https://…'}
          error={error}
          onChange={(event) => setUrl(event.target.value)}
        />
      </form>
    </Sheet>
  );
}

/**
 * The places outside Madar that a project uses: the moodboard, the office folder, the map pin, the client's delivery
 * folder (colleague comment 5, owner approved 2026-10-01). Only links that exist show; one button adds another.
 * A web link opens in a new tab. An office network path cannot open in a browser, so it gets a Copy button.
 */
export function ProjectLinks({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { project, viewerCan } = detail;
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  const [open, setOpen] = useState(false);
  const [byHand, setByHand] = useState<string | null>(null);
  const rows: ProjectLink[] = [
    ...(project.modelFolderPath ? [{ id: MODEL_FOLDER, kind: 'folder' as const, label: t('links.modelFolder'), url: project.modelFolderPath }] : []),
    ...(project.links ?? []),
  ];
  if (rows.length === 0 && !viewerCan.post) return null;
  // A plain http:// office server has no clipboard, and a browser may refuse it. The person then gets the path selected,
  // to copy it with the keyboard, and a toast says so (audit 2026-10-03, PRJ-15).
  const copy = (link: ProjectLink) => {
    const manual = () => {
      setByHand(link.id);
      toast.show({ tone: 'error', message: t('links.copyByHand') });
    };
    if (!navigator.clipboard) {
      manual();
      return;
    }
    navigator.clipboard.writeText(link.url).then(() => toast.show({ message: t('links.copied') }), manual);
  };
  const openSheet = (link: ProjectLink | null) => {
    setEditing(link);
    setOpen(true);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2">{t('links.title')}</h3>
      {rows.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {rows.map((link) => {
            const name = link.label || (isNetworkPath(link.url) ? link.url : hostOf(link.url));
            const body = (
              <>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-fill text-ink-2"><AnimatedIcon icon={ICON[link.kind]} size={18} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-caption text-ink-2">{t(`links.kinds.${link.kind}`)}</span>
                  <bdi dir={isNetworkPath(link.url) ? 'ltr' : 'auto'} className="block truncate text-subheadline text-ink">{name}</bdi>
                </span>
              </>
            );
            return (
              <li key={link.id} className="flex min-h-11 flex-wrap items-center gap-1">
                {/* The server refuses other links, but stored data is checked again here: only a web link ever gets an href. */}
                {!linkUrlOk('other', link.url) && !isNetworkPath(link.url) ? (
                  <span className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">{body}</span>
                ) : isNetworkPath(link.url) ? (
                  <span className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">
                    {body}
                    <button type="button" onClick={() => copy(link)} aria-label={t('links.copy', { name })} className="pressable grid size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-fill hover:text-ink">
                      <AnimatedIcon icon={CopyIcon} size={16} aria-hidden />
                    </button>
                  </span>
                ) : (
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="pressable flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-fill">
                    {body}
                    <AnimatedIcon icon={ExternalLinkIcon} size={16} className="shrink-0 text-ink-2 rtl:-scale-x-100" aria-hidden />
                  </a>
                )}
                {viewerCan.post && link.id !== MODEL_FOLDER && (
                  <button type="button" onClick={() => openSheet(link)} aria-label={t('links.edit', { name })} className="pressable grid size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-fill hover:text-ink">
                    <AnimatedIcon icon={SquarePenIcon} size={16} aria-hidden />
                  </button>
                )}
                {byHand === link.id && <PathField path={link.url} onDone={() => setByHand(null)} />}
              </li>
            );
          })}
        </ul>
      )}
      {viewerCan.post && (
        <Button variant="plain" className="-ms-3 self-start" onClick={() => openSheet(null)}>
          <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
          {t('links.addLink')}
        </Button>
      )}
      <LinkSheet detail={detail} link={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
