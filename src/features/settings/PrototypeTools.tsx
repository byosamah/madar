import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewAs } from '../../app/PreviewAs';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Switch } from '../../components/Switch';

/**
 * The prototype controls: Preview as, Simulate errors and Reset sample data with its question. They stay out of the real build
 * (client map 6), so a screen that mounts them checks the build first. The Settings page of a desk and the Me hub of a phone share them.
 */
export function PrototypeTools() {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useCall('session.get', {});
  const simulate = useAction('session.setSimulateErrors');
  // Reset wipes the whole office in this browser and has no Undo, so it asks first, like Delete project (audit 2026-10-03, SHL-8).
  const [askReset, setAskReset] = useState(false);
  const reset = useAction('session.resetSampleData', {
    onSuccess: () => {
      setAskReset(false);
      toast.show({ message: t('settings.resetDone') });
    },
  });
  if (!session.data) return null;

  return (
    <>
      <PreviewAs id="preview-as-settings" />
      <Switch
        id="simulate-errors"
        label={t('settings.simulateErrors')}
        description={t('settings.simulateErrorsHint')}
        checked={session.data.simulateErrors}
        onChange={(on) => simulate.mutate({ on })}
      />
      <div>
        <Button onClick={() => setAskReset(true)}>{t('settings.reset')}</Button>
      </div>
      <Sheet
        open={askReset}
        onOpenChange={setAskReset}
        title={t('settings.resetTitle')}
        description={t('settings.resetBody')}
        footer={(
          <>
            <Button onClick={() => setAskReset(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={reset.isPending} onClick={() => reset.mutate({})}>{t('settings.reset')}</Button>
          </>
        )}
      >
        {null}
      </Sheet>
    </>
  );
}
