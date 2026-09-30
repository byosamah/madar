import { Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { MAX_FILE_BYTES } from '../../../api/contract/entities';
import type { ProjectDetail, UserCard } from '../../../api/contract/views';
import { newStoryId } from '../../../app/actions';
import { errorMessage } from '../../../app/errors';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { activeMention, normalizeForSearch, withMentionMarkup } from '../../../lib/text';

/** The box that posts text with files and @mentions (spec 5.2). Type @ to pick a teammate. */
export function Composer({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [params, setParams] = useSearchParams();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<UserCard[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);

  const me = session.data?.authority.id;
  const people = detail.members.map((member) => member.user).filter((person) => person.id !== me);
  const mention = activeMention(text, caret);
  const matches = mention
    ? people.filter((person) => normalizeForSearch(person.name).includes(normalizeForSearch(mention.query))).slice(0, 5)
    : [];
  const open = matches.length > 0 && dismissedAt !== mention?.start;

  useEffect(() => {
    if (params.get('compose') !== '1') return;
    area.current?.focus();
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('compose');
      return next;
    }, { replace: true });
  }, [params, setParams]);

  const pick = (person: UserCard) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const insert = `@${person.name} `;
    const next = before + insert + text.slice(caret);
    const position = before.length + insert.length;
    setText(next);
    setCaret(position);
    setActive(0);
    setPicked((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]));
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(matches[active] ?? matches[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDismissedAt(mention?.start ?? null);
    }
  };

  const addFiles = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    for (const file of chosen.filter((f) => f.size > MAX_FILE_BYTES)) toast.show({ tone: 'error', message: t('files.tooBig', { name: file.name }) });
    setFiles((current) => [...current, ...chosen.filter((f) => f.size <= MAX_FILE_BYTES)]);
  };

  const post = async (event: FormEvent) => {
    event.preventDefault();
    const body = withMentionMarkup(text.trim(), picked);
    if (!body) return;
    const meta = { correlationId: newStoryId() };
    setPosting(true);
    try {
      const fileIds: string[] = [];
      for (const file of files) {
        const view = await api.call('files.upload', { projectId: detail.project.id, name: file.name, blob: file, stageId: detail.currentStage.id }, meta);
        fileIds.push(view.file.id);
      }
      await api.call('updates.create', { projectId: detail.project.id, body, fileIds }, meta);
      setText('');
      setPicked([]);
      setFiles([]);
      toast.show({ message: t('overview.posted') });
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setPosting(false);
    }
  };

  return (
    <form onSubmit={post} aria-label={t('overview.composer')} className="surface flex flex-col gap-3 rounded-card p-4">
      <div className="relative">
        <label htmlFor="composer" className="sr-only">{t('overview.composer')}</label>
        <textarea
          id="composer"
          ref={area}
          value={text}
          dir="auto"
          rows={3}
          placeholder={t('overview.placeholder')}
          aria-autocomplete="list"
          aria-controls={open ? 'mention-list' : undefined}
          aria-activedescendant={open && matches[active] ? `mention-${matches[active].id}` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setDismissedAt(null);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          className="min-h-24 w-full resize-y rounded-control bg-fill px-3 py-2 text-body text-label placeholder:text-label-2"
        />
        {open && (
          <ul id="mention-list" role="listbox" aria-label={t('overview.mentionList')} className="glass absolute inset-x-0 top-full z-30 mt-1 flex flex-col rounded-2xl p-1.5 shadow-float">
            {matches.map((person, i) => (
              <li
                key={person.id}
                id={`mention-${person.id}`}
                role="option"
                aria-selected={i === active}
                onPointerDown={(event) => {
                  event.preventDefault();
                  pick(person);
                }}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 ${i === active ? 'bg-fill' : ''}`}
              >
                <span aria-hidden><Avatar user={person} size={24} /></span>
                <bdi>{person.name}</bdi>
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-fill ps-3">
              <bdi className="text-footnote">{file.name}</bdi>
              <IconButton label={t('overview.removeFile', { name: file.name })} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                <X size={14} aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        <label className="pressable inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-subheadline font-semibold text-accent hover:bg-fill">
          <Paperclip size={18} aria-hidden />
          {t('overview.attach')}
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        <Button variant="primary" type="submit" disabled={!text.trim() || posting}>{t('overview.post')}</Button>
      </div>
    </form>
  );
}
