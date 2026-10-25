import { scrubText, scrubUrl } from '../../lib/urlScrub';

type Props = Record<string, unknown>;

/** The properties that hold a full page address. */
const URL_KEYS = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer'] as const;

const isRecord = (value: unknown): value is Props => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The type number of an rrweb Meta item. It holds the address of the page in `data.href`. */
const RRWEB_META = 4;

function scrubProps(properties: Props): Props {
  const out: Props = { ...properties };
  for (const key of URL_KEYS) {
    if (typeof out[key] === 'string') out[key] = scrubUrl(out[key]);
  }
  if (typeof out.$exception_message === 'string') out.$exception_message = scrubText(out.$exception_message);
  if (Array.isArray(out.$exception_list)) {
    out.$exception_list = out.$exception_list.map((item) => (isRecord(item) && typeof item.value === 'string' ? { ...item, value: scrubText(item.value) } : item));
  }
  if (Array.isArray(out.$snapshot_data)) {
    out.$snapshot_data = out.$snapshot_data.map((item) => {
      if (!isRecord(item) || item.type !== RRWEB_META || !isRecord(item.data) || typeof item.data.href !== 'string') return item;
      return { ...item, data: { ...item.data, href: scrubUrl(item.data.href) } };
    });
  }
  // A link in a clicked element can hold a task id or a search text. The elements come as a list and as one text chain.
  if (Array.isArray(out.$elements)) {
    out.$elements = out.$elements.map((item) => (isRecord(item) && typeof item.attr__href === 'string' ? { ...item, attr__href: scrubUrl(item.attr__href) } : item));
  }
  if (typeof out.$elements_chain === 'string') {
    out.$elements_chain = out.$elements_chain.replace(/(attr__href=")([^"]*)(")/g, (_all, open: string, href: string, close: string) => `${open}${scrubUrl(href)}${close}`);
  }
  return out;
}

/**
 * The `before_send` scrub of every PostHog record (insight design, section 5, rules 5 and 8). It returns a copy, never changes its
 * input, and never throws: a record of a shape it does not know comes back as it is.
 */
export function scrubEvent<T extends { event: string; properties?: Record<string, unknown> }>(event: T): T {
  try {
    if (!isRecord(event.properties)) return event;
    return { ...event, properties: scrubProps(event.properties) };
  } catch {
    return event;
  }
}
