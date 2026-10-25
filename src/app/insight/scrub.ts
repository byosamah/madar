import { scrubText, scrubUrl } from '../../lib/urlScrub';

type Props = Record<string, unknown>;

const isRecord = (value: unknown): value is Props => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The type number of an rrweb Meta item. It holds the address of the page in `data.href`. */
const RRWEB_META = 4;

/** How deep the walk goes into nested objects. Lists do not count. */
const MAX_DEPTH = 5;

/** A key that holds an address, by its end: `$current_url`, `attr__href`, `$session_entry_referrer`, `$pathname`. */
const ADDRESS_KEY = /(url|href|referrer|pathname)$/i;

/** One string by its key. A full address is always scrubbed. A path or a loose value is scrubbed when its key says it is an address. */
function scrubString(key: string, value: string, inException: boolean): string {
  if (inException) return scrubText(value);
  if (/^https?:\/\//i.test(value)) return scrubUrl(value);
  if (ADDRESS_KEY.test(key) && (value.startsWith('/') || /[?#]/.test(value))) return scrubUrl(value);
  return value;
}

/** Walks a value. It copies every object and list it changes, and never changes its input. */
function walk(key: string, value: unknown, depth: number, inException: boolean): unknown {
  if (typeof value === 'string') return scrubString(key, value, inException);
  if (Array.isArray(value)) return value.map((item) => walk(key, item, depth, inException));
  if (!isRecord(value) || depth >= MAX_DEPTH) return value;
  const out: Props = {};
  for (const [name, item] of Object.entries(value)) out[name] = walk(name, item, depth + 1, inException || name === '$exception_list');
  return out;
}

function scrubProps(properties: Props): Props {
  const out: Props = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === '$snapshot_data') {
      out[key] = scrubSnapshot(value);
    } else if (key === '$exception_message' && typeof value === 'string') {
      out[key] = scrubText(value);
    } else if (key === '$elements_chain' && typeof value === 'string') {
      out[key] = value.replace(/(attr__href=")([^"]*)(")/g, (_all, open: string, href: string, close: string) => `${open}${scrubUrl(href)}${close}`);
    } else {
      out[key] = walk(key, value, 1, key === '$exception_list');
    }
  }
  return out;
}

/** A replay packet holds many items. Only the Meta items hold an address, so only they are read (a speed rule). */
function scrubSnapshot(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item) || item.type !== RRWEB_META || !isRecord(item.data) || typeof item.data.href !== 'string') return item;
    return { ...item, data: { ...item.data, href: scrubUrl(item.data.href) } };
  });
}

/**
 * The `before_send` scrub of every PostHog record (insight design, section 5, rules 5 and 8). It returns a copy and never changes its
 * input. It reads every nested value, whatever its key, and the `$set` and `$set_once` objects of the record and of its properties.
 * It fails closed: a record that it cannot read comes back as null, and PostHog drops a record when `before_send` gives null.
 * A record with no properties object comes back as it is.
 */
export function scrubEvent<T extends { event: string; properties?: Record<string, unknown> }>(event: T): T | null {
  try {
    const out: Record<string, unknown> = { ...event };
    for (const key of ['$set', '$set_once'] as const) {
      if (isRecord(out[key])) out[key] = walk(key, out[key], 1, false);
    }
    if (isRecord(event.properties)) out.properties = scrubProps(event.properties);
    return out as T;
  } catch {
    return null;
  }
}
