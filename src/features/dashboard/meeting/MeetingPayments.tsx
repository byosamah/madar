import { useCall } from '../../../app/runtime';
import { PaymentsPanel } from '../../project/payments/PaymentsPanel';

/**
 * The payments of a project, inside the meeting. It uses the rule of the project Overview: only a viewer who may manage
 * payments sees it, and nobody else makes the payments call. A project without payments shows no panel at all.
 */
export function MeetingPayments({ projectId }: { projectId: string }) {
  const detail = useCall('projects.get', { id: projectId });
  const sees = detail.data?.viewerCan.payments === true;
  const payments = useCall('payments.list', { projectId }, { enabled: sees });
  if (!sees || !payments.data || payments.data.length === 0) return null;
  return <PaymentsPanel projectId={projectId} />;
}
