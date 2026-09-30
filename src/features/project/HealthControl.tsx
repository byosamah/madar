import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthValue } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useAction } from '../../app/runtime';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { HealthPill } from '../../components/HealthPill';
import { Popover } from '../../components/Popover';
import { SegmentedControl } from '../../components/SegmentedControl';

const VALUES: HealthValue[] = ['on_track', 'at_risk', 'late'];

function HealthPopover({ detail, anchor, onClose }: { detail: ProjectDetail; anchor: HTMLElement; onClose: () => void }) {
  const { t } = useTranslation();
  const health = detail.health!;
  const [value, setValue] = useState<HealthValue>(health.value);
  const [reason, setReason] = useState(health.overridden ? (health.reason ?? '') : '');
  const set = useAction('projects.setHealthOverride', { onSuccess: onClose });
  const clear = useAction('projects.clearHealthOverride', { onSuccess: onClose });
  return (
    <Popover anchor={anchor} label={t('health.override')} onClose={onClose}>
      <div>
        <p className="text-headline">{t('health.override')}</p>
        <p className="text-footnote text-label-2">{t('health.overrideHint')}</p>
      </div>
      <SegmentedControl label={t('health.override')} value={value} onChange={setValue} options={VALUES.map((v) => ({ value: v, label: t(`health.${v}`) }))} />
      <TextArea id="health-reason" label={t('health.reason')} value={reason} dir="auto" onChange={(event) => setReason(event.target.value)} />
      <p className="text-footnote text-label-2">{t('health.computed', { value: t(`health.${health.computed}`) })}</p>
      <div className="flex flex-wrap justify-end gap-2">
        {health.overridden && <Button onClick={() => clear.mutate({ id: detail.project.id })}>{t('health.clear')}</Button>}
        <Button variant="primary" disabled={!reason.trim() || set.isPending} onClick={() => set.mutate({ id: detail.project.id, value, reason: reason.trim() })}>
          {t('health.save')}
        </Button>
      </div>
    </Popover>
  );
}

/** The leader or the Admin can set the health by hand with a reason (spec 4.2). Others see the pill only. */
export function HealthControl({ detail }: { detail: ProjectDetail }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const pill = <HealthPill health={detail.health} status={detail.project.status} setBy={detail.healthSetBy} />;
  if (!detail.viewerCan.healthOverride || !detail.health) return pill;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        className="pressable -my-2 grid min-h-11 place-items-center rounded-full"
      >
        {pill}
      </button>
      {anchor && <HealthPopover detail={detail} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}
