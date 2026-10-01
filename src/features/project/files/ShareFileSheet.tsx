import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileView } from '../../../api/contract/views';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextArea } from '../../../components/Fields';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Sheet } from '../../../components/Sheet';

type Kind = 'project_chat' | 'person' | 'task';

/**
 * Posts one project file into the project chat, a direct chat or a task conversation.
 * The API decides who may open the file. A refusal shows as a message and the sheet stays open.
 */
export function ShareFileSheet({ view, projectId, onClose }: { view: FileView; projectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useCall('session.get', {});
  const users = useCall('users.list', {});
  const tasks = useCall('tasks.list', { projectId, activeProjectsOnly: false });
  const [kind, setKind] = useState<Kind>('project_chat');
  const [userId, setUserId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [message, setMessage] = useState('');
  const share = useAction('files.share', {
    onSuccess: () => {
      toast.show({ message: t('files.shared') });
      onClose();
    },
  });
  const me = session.data?.authority.id;
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && user.id !== me);
  const ready = kind === 'project_chat' || (kind === 'person' && userId !== '') || (kind === 'task' && taskId !== '');
  const submit = () => {
    if (!ready || share.isPending) return;
    const target = kind === 'person' ? { kind, userId } : kind === 'task' ? { kind, taskId } : { kind };
    share.mutate({ fileId: view.file.id, target, message });
  };
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('files.shareTitle', { name: view.file.name })}
      footer={<Button variant="primary" disabled={!ready || share.isPending} onClick={submit}>{t('files.shareSend')}</Button>}
    >
      <form
        className="flex flex-col gap-4 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <SegmentedControl
          label={t('files.shareWhere')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'project_chat', label: t('files.shareChat') },
            { value: 'person', label: t('files.sharePerson') },
            { value: 'task', label: t('files.shareTask') },
          ]}
        />
        {kind === 'person' && (
          <SelectField id="share-person" label={t('files.pickPerson')} value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">{t('files.sharePickPerson')}</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </SelectField>
        )}
        {kind === 'task' && (
          <SelectField
            id="share-task"
            label={t('files.pickTask')}
            value={taskId}
            hint={tasks.data && tasks.data.length === 0 ? t('files.shareNoTasks') : undefined}
            onChange={(event) => setTaskId(event.target.value)}
          >
            <option value="">{t('files.sharePickTask')}</option>
            {(tasks.data ?? []).map((row) => <option key={row.task.id} value={row.task.id}>{row.task.title}</option>)}
          </SelectField>
        )}
        <TextArea id="share-message" label={t('files.shareMessage')} value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} />
      </form>
    </Sheet>
  );
}
