import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthValue } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { usePersonName } from '../../app/personName';
import { useAction } from '../../app/runtime';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { SheetOrPopover } from '../../components/SheetOrPopover';
import { useIsPhone } from '../../app/useIsPhone';
import { SegmentedControl } from '../../components/SegmentedControl';
import { ProjectSign } from '../../components/ProjectSign';
import { StatusSign } from '../../components/StatusSign';

const VALUES: HealthValue[] = ['on_track', 'at_risk', 'late'];

/** The form inside the panel. It mounts when the panel opens, so its fields start again each time. */
function HealthForm({ detail, onClose }: { detail: ProjectDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const health = detail.health!;
  const [value, setValue] = useState<HealthValue>(health.value);
  const [reason, setReason] = useState(health.overridden ? (health.reason ?? '') : '');
  const set = useAction('projects.setHealthOverride', { onSuccess: onClose });
  const clear = useAction('projects.clearHealthOverride', { onSuccess: onClose });
  return (
    <div className="flex flex-col gap-3">
      <div>
        {/* The sheet of a phone draws the title itself. */}
        {!phone && <p className="text-headline text-ink">{t('health.override')}</p>}
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
    </div>
  );
}

/** Late and At risk show as a soft word; On track says nothing, except to the person who may change it (redesign spec 2.4). */
function HealthWord({ detail, canSet }: { detail: ProjectDetail; canSet: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const { health, healthSetBy } = detail;
  if (!health) return <ProjectSign project={detail.project} staleDays={detail.staleDays} />;
  if (health.value === 'on_track' && !canSet && !health.overridden) return null;
  return (
    <span title={health.overridden && health.reason ? health.reason : undefined} className="inline-flex items-center gap-2">
      <StatusSign state={health.value}>{t(`health.${health.value}`)}</StatusSign>
      {health.overridden && healthSetBy && <span className="text-footnote text-ink-2">{t('health.setBy', { name: nameOf(healthSetBy) })}</span>}
    </span>
  );
}

/** The leader or the Admin can set the health by hand with a reason (spec 4.2). Others see the word only. */
export function HealthControl({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
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
      <SheetOrPopover open={anchor !== null} onOpenChange={(open) => { if (!open) setAnchor(null); }} anchor={anchor} title={t('health.override')}>
        <HealthForm detail={detail} onClose={() => setAnchor(null)} />
      </SheetOrPopover>
    </>
  );
}
