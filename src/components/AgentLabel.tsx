import { useTranslation } from 'react-i18next';

/** Every change by an AI agent carries this label (spec 10.7). */
export function AgentLabel() {
  const { t } = useTranslation();
  return <span className="inline-flex rounded-full bg-fill px-1.5 text-caption font-semibold text-label-2">{t('common.agent')}</span>;
}
