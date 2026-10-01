import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthValue } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useAction } from '../../app/runtime';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { Popover } from '../../components/Popover';
import { SegmentedControl } from '../../components/SegmentedControl';
import { StateWord } from '../../components/StateWord';

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
        <p className="text-headline text-ink">{t('health.override')}</p>
        <p className="text-footnote text-ink-2">{t('health.overrideHint')}</p>
      </div>
      <SegmentedControl label={t('health.override')} value={value} onChange={setValue} options={VALUES.map((v) => ({ value: v, label: t(`health.${v}`) }))} />
      <TextArea id="health-reason" label={t('health.reason')} value={reason} dir="auto" onChange={(event) => setReason(event.target.value)} />
      <p className="text-footnote text-ink-2">{t('health.computed', { value: t(`health.${health.computed}`) })}</p>
      <div className="flex flex-wrap justify-end gap-2">
        {health.overridden && <Button onClick={() => clear.mutate({ id: detail.project.id })}>{t('health.clear')}</Button>}
        <Button variant="primary" disabled={!reason.trim() || set.isPending} onClick={() => set.mutate({ id: detail.project.id, value, reason: reason.trim() })}>
          {t('health.save')}
        </Button>
      </div>
    </Popover>
  );
}

/** Late and At risk show as a soft word; On track says nothing, except to the person who may change it (redesign spec 2.4). */
function HealthWord({ detail, canSet }: { detail: ProjectDetail; canSet: boolean }) {
  const { t } = useTranslation();
  const { health, healthSetBy } = detail;
  if (!health) return <StateWord tone="quiet">{t(`status.${detail.project.status}`)}</StateWord>;
  if (health.value === 'on_track' && !canSet && !health.overridden) return null;
  const tone = health.value === 'late' ? 'late' : health.value === 'at_risk' ? 'attn' : 'quiet';
  return (
    <span title={health.overridden && health.reason ? health.reason : undefined} className="inline-flex items-center gap-2">
      <StateWord tone={tone}>{t(`health.${health.value}`)}</StateWord>
      {health.overridden && healthSetBy && <span className="text-footnote text-ink-2">{t('health.setBy', { name: healthSetBy.name })}</span>}
    </span>
  );
}

/** The leader or the Admin can set the health by hand with a reason (spec 4.2). Others see the word only. */
export function HealthControl({ detail }: { detail: ProjectDetail }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!detail.viewerCan.healthOverride || !detail.health) return <HealthWord detail={detail} canSet={false} />;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        className="pressable -my-2 grid min-h-11 place-items-center rounded-full"
      >
        <HealthWord detail={detail} canSet />
      </button>
      {anchor && <HealthPopover detail={detail} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}
