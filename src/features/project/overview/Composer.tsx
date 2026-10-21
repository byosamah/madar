import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { ProjectDetail } from '../../../api/contract/views';
import { newStoryId } from '../../../app/actions';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { MentionField } from '../../../components/MentionField';
import { withMentionMarkup } from '../../../lib/text';
import { AttachButton, PickedFiles, useAttachments } from '../../files/Attachments';

/** A post carries up to 20 files (spec 5.2). */
const MAX_POST_FILES = 20;

/** The box that posts text with files and @mentions (spec 5.2). Type @ to pick a teammate. */
export function Composer({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [params, setParams] = useSearchParams();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const attachments = useAttachments(MAX_POST_FILES);
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

  const post = async (event: FormEvent) => {
    event.preventDefault();
    // Every project person counts, also a name typed without the list (plan clarification 9).
    const body = withMentionMarkup(text.trim(), people);
    if (!body) return;
    const meta = { correlationId: newStoryId() };
    setPosting(true);
    try {
      const fileIds = await attachments.upload({ projectId: detail.project.id, stageId: detail.currentStage.id }, meta);
      await api.call('updates.create', { projectId: detail.project.id, body, fileIds }, meta);
      setText('');
      attachments.clear();
      toast.show({ message: t('overview.posted') });
    } catch (error) {
      toast.failed(error);
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
      <PickedFiles files={attachments.files} onRemove={attachments.remove} />
      <div className="flex items-center justify-between gap-2">
        {detail.viewerCan.upload ? <AttachButton onPick={attachments.add} /> : <span />}
        <Button variant={text.trim() ? 'primary' : 'secondary'} type="submit" disabled={!text.trim() || posting}>{t('overview.post')}</Button>
      </div>
    </form>
  );
}
