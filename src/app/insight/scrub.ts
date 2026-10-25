import { scrubText, scrubUrl } from '../../lib/urlScrub';

type Props = Record<string, unknown>;

const isRecord = (value: unknown): value is Props => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The type number of an rrweb Meta item. It holds the address of the page in `data.href`. */
const RRWEB_META = 4;

/** A key that holds an address, by its end: `$current_url`, `attr__href`, `$session_entry_referrer`, `$pathname`. */
const ADDRESS_KEY = /(url|href|referrer|pathname)$/i;

/**
 * One string by its key. A value that is a whole address is cut by `scrubUrl`. A path or a loose value under an address key is cut too.
 * Any other text goes through `scrubText`, so an address inside free text loses its query and its hash, whatever the key.
 */
function scrubString(key: string, value: string): string {
  if (/^https?:\/\/\S*$/i.test(value)) return scrubUrl(value);
  if (ADDRESS_KEY.test(key) && (value.startsWith('/') || /[?#]/.test(value))) return scrubUrl(value);
  return scrubText(value);
}

/**
 * Walks a value to any depth. It copies every object and list, and never changes its input. `parents` holds the objects on the way
 * down: an object that holds itself becomes the text '[cycle]'. An object that appears twice with no loop is walked twice.
 */
function walk(key: string, value: unknown, parents: Set<object>): unknown {
  if (typeof value === 'string') return scrubString(key, value);
  if (typeof value !== 'object' || value === null || value instanceof Date) return value;
  if (parents.has(value)) return '[cycle]';
  parents.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => walk(key, item, parents));
    const out: Props = {};
    for (const [name, item] of Object.entries(value)) out[name] = walk(name, item, parents);
    return out;
  } finally {
    parents.delete(value);
  }
}

function scrubProps(properties: Props): Props {
  const out: Props = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === '$snapshot_data') {
      out[key] = scrubSnapshot(value);
    } else if (key === '$elements_chain' && typeof value === 'string') {
      // The links of the chain sit inside quotes, so the chain gets its own rule first. The general text rule runs after it.
      out[key] = scrubText(value.replace(/(attr__href=")([^"]*)(")/g, (_all, open: string, href: string, close: string) => `${open}${scrubUrl(href)}${close}`));
    } else {
      out[key] = walk(key, value, new Set([properties]));
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
 * input. It reads every nested value to any depth, whatever its key, and the `$set` and `$set_once` objects of the record and of its properties.
 * It fails closed: a record that it cannot read comes back as null, and PostHog drops a record when `before_send` gives null.
 * A record with no properties object comes back as it is.
 */
export function scrubEvent<T extends { event: string; properties?: Record<string, unknown> }>(event: T): T | null {
  try {
    const out: Record<string, unknown> = { ...event };
    for (const key of ['$set', '$set_once'] as const) {
      if (isRecord(out[key])) out[key] = walk(key, out[key], new Set([event]));
    }
    if (isRecord(event.properties)) out.properties = scrubProps(event.properties);
    return out as T;
  } catch {
    return null;
  }
}
