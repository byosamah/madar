import { useTranslation } from 'react-i18next';

const REASONS = ['signed_out', 'expired', 'account_off'] as const;
type Reason = (typeof REASONS)[number];

/** One calm line on the Sign in screen that says why the person is there (client map 7.1). An unknown reason shows nothing. */
export function SignedOutNote({ reason }: { reason: string | null }) {
  const { t } = useTranslation();
  if (!REASONS.includes(reason as Reason)) return null;
  const text = reason === 'account_off' ? t('errors.reasons.account_off') : t(`auth.reasons.${reason as Exclude<Reason, 'account_off'>}`);
  return <p role="status" className="rounded-xl bg-fill px-3 py-2 text-footnote text-ink-2">{text}</p>;
}
