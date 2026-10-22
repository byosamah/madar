import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useAction, useCall } from '../../../app/runtime';
import { useRight } from '../../../app/useRight';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextArea } from '../../../components/Fields';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Sheet } from '../../../components/Sheet';
import { taskLink } from '../../../lib/params';

type Kind = 'project_chat' | 'person' | 'task';

/** The places that the person may share into, from the switches (role rights version 2). */
export function sharePlaces(viewerCan: ProjectDetail['viewerCan'], direct: boolean): Kind[] {
  return [...(viewerCan.projectChat ? ['project_chat' as const] : []), ...(direct ? ['person' as const] : []), ...(viewerCan.comment ? ['task' as const] : [])];
}

/**
 * Posts one project file into the project chat, a direct chat or a task conversation.
 * The API decides who may open the file. A refusal shows as a message and the sheet stays open.
 * Role rights version 2: a place shows only when its switch is on. The project chat needs chat.project, a person needs chat.direct,
 * and a to-do needs comment.create (the share is a comment there).
 */
export function ShareFileSheet({ view, projectId, projectName, viewerCan, onClose }: {
  view: FileView; projectId: string; projectName: string; viewerCan: ProjectDetail['viewerCan']; onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const session = useCall('session.get', {});
  const users = useCall('users.list', {});
  const tasks = useCall('tasks.list', { projectId, activeProjectsOnly: false });
  const places = sharePlaces(viewerCan, useRight('chat.direct'));
  const [kind, setKind] = useState<Kind>(places[0] ?? 'project_chat');
  const [userId, setUserId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [message, setMessage] = useState('');
  const me = session.data?.authority.id;
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && user.id !== me).sort(byName);
  // The toast says where the file went, and Open goes there: the chat, or the conversation of the task (audit 2026-10-03, F-20).
  const share = useAction('files.share', {
    onSuccess: (place) => {
      const message = place.kind === 'project_chat'
        ? t('files.sharedChat', { project: projectName })
        : place.kind === 'person'
          ? t('files.sharedPerson', { name: ((found) => (found ? nameOf(found) : ''))(people.find((person) => person.id === userId)) })
          : t('files.sharedTask', { title: tasks.data?.find((row) => row.task.id === place.id)?.task.title ?? '' });
      // A chat opens full screen on a phone. Back returns to the screen that opened it (phone D, lead amendment 6).
      const from = location.pathname + location.search;
      const to = place.kind === 'task' ? taskLink(projectId, place.id, true) : `/inbox/${place.id}`;
      toast.show({ message, action: { label: t('files.sharedOpen'), run: () => navigate(to, place.kind === 'task' ? undefined : { state: { from } }), isUndo: false } });
      onClose();
    },
  });
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
          options={([
            { value: 'project_chat', label: t('files.shareChat') },
            { value: 'person', label: t('files.sharePerson') },
            { value: 'task', label: t('files.shareTask') },
          ] as const).filter((option) => places.includes(option.value))}
        />
        {kind === 'person' && (
          <SelectField id="share-person" label={t('files.pickPerson')} value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">{t('files.sharePickPerson')}</option>
            {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
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
