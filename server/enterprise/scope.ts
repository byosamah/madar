import type { Config } from '../core/ports';
import { ENT_VADO, type EnterpriseId } from './ids';

/**
 * The enterprise of a Config. The office object sets Config.ent from its identity row. The Postgres path leaves it out, and a
 * missing value means VADOs' Companies.
 */
export function entOfConfig(config: Pick<Config, 'ent'>): EnterpriseId {
  return config.ent ?? ENT_VADO;
}

/**
 * Puts the enterprise id in front of a shared key. Record ids such as usr_001 repeat in every enterprise, so a mail key and a
 * mail_log ref carry the enterprise id. Resend keeps one idempotency key for the whole account.
 */
export function scopedRef(ent: EnterpriseId, key: string): string {
  return `${ent}:${key}`;
}
