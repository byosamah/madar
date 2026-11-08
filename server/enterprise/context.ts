import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogFields, Logger } from '../core/ports';
import type { EnterpriseId } from './ids';

/**
 * The enterprise of the running request (Madar enterprises, design 5.16). One Worker isolate serves many enterprises at one time, so a
 * shared logger cannot hold the id in a variable. The Worker route runs the rest of each request inside runInEnterprise as soon as
 * the enterprise is known (from a token claim, a tag, an address or an email), and entLogger reads the id from that scope. The scope
 * follows the awaits of one request and never meets the scope of another request. The same as server/core/after.ts does for the host.
 */
const scope = new AsyncLocalStorage<EnterpriseId>();

/** Runs the work of one request for one enterprise. */
export function runInEnterprise<T>(ent: EnterpriseId, work: () => T): T {
  return scope.run(ent, work);
}

/** The enterprise of the running request, or undefined outside a scope. */
export function currentEnterprise(): EnterpriseId | undefined {
  return scope.getStore();
}

/**
 * A logger that adds { ent } to the fields of every line. The id comes from the getter on each line, not once. A line that sets its own
 * `ent` keeps it. A getter that throws or gives nothing adds nothing, and the line is written as it is.
 */
export function entLogger(log: Logger, ent: () => EnterpriseId | undefined): Logger {
  const fieldsOf = (fields: LogFields | undefined): LogFields | undefined => {
    if (fields !== undefined && Object.hasOwn(fields, 'ent')) return fields;
    let id: EnterpriseId | undefined;
    try {
      id = ent();
    } catch {
      id = undefined;
    }
    return id === undefined ? fields : { ...fields, ent: id };
  };
  return {
    info: (message, fields) => log.info(message, fieldsOf(fields)),
    warn: (message, fields) => log.warn(message, fieldsOf(fields)),
    error: (message, fields) => log.error(message, fieldsOf(fields)),
  };
}
