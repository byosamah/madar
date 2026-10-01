import { Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { MAX_FILE_BYTES } from '../../../api/contract/entities';
import type { ProjectDetail } from '../../../api/contract/views';
import { newStoryId } from '../../../app/actions';
import { errorMessage } from '../../../app/errors';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { MentionField } from '../../../components/MentionField';
import { withMentionMarkup } from '../../../lib/text';

/** The box that posts text with files and @mentions (spec 5.2). Type @ to pick a teammate. */
export function Composer({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [params, setParams] = useSearchParams();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef(new Map<File, string>());
  const [posting, setPosting] = useState(false);
  const me = session.data?.authority.id;
  const people = detail.members.map((member) => member.user).filter((person) => person.id !== me);

  useEffect(() => {
    if (params.get('compose') !== '1') return;
    area.current?.focus();
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('compose');
      return next;
    }, { replace: true });
  }, [params, setParams]);

  const addFiles = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    for (const file of chosen.filter((f) => f.size > MAX_FILE_BYTES)) toast.show({ tone: 'error', message: t('files.tooBig', { name: file.name }) });
    setFiles((current) => [...current, ...chosen.filter((f) => f.size <= MAX_FILE_BYTES)]);
  };

  const post = async (event: FormEvent) => {
    event.preventDefault();
    // Every project person counts, also a name typed without the list (plan clarification 9).
    const body = withMentionMarkup(text.trim(), people);
    if (!body) return;
    const meta = { correlationId: newStoryId() };
    setPosting(true);
    try {
      const fileIds: string[] = [];
      for (const file of files) {
        // A file that went up before a failed post is not sent a second time.
        let id = uploaded.current.get(file);
        if (!id) {
          const view = await api.call('files.upload', { projectId: detail.project.id, name: file.name, blob: file, stageId: detail.currentStage.id }, meta);
          id = view.file.id;
          uploaded.current.set(file, id);
        }
        fileIds.push(id);
      }
      await api.call('updates.create', { projectId: detail.project.id, body, fileIds }, meta);
      setText('');
      setFiles([]);
      uploaded.current.clear();
      toast.show({ message: t('overview.posted') });
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setPosting(false);
    }
  };

  return (
    <form onSubmit={post} aria-label={t('overview.composer')} className="panel flex flex-col gap-3 p-4">
      <MentionField
        id="composer"
        label={t('overview.composer')}
        value={text}
        onChange={setText}
        people={people}
        placeholder={t('overview.placeholder')}
        inputRef={area}
        className="[&_textarea]:min-h-24"
      />
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
        <label className="pressable inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-subheadline font-semibold text-accent hover:bg-fill has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
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
        <Button variant={text.trim() ? 'primary' : 'secondary'} type="submit" disabled={!text.trim() || posting}>{t('overview.post')}</Button>
      </div>
    </form>
  );
}
