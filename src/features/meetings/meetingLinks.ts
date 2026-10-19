import type { GeoPoint } from '../../api/contract/entities';
import { phaseOf } from '../../lib/meetings';

/** The main button of a meeting shows "Join" from this many minutes before the start (fbk_022). */
export const JOIN_LEAD_MIN = 30;

/**
 * The link of a place (fbk_022). A place that starts with https:// and holds no space is one link, and the sheet shows a "Join"
 * button for it. Any other text is a plain place. A link that does not start with https:// (http, javascript) is never one.
 */
export function joinLink(where: string): string | null {
  const text = where.trim();
  if (!text.startsWith('https://') || /\s/.test(text)) return null;
  try {
    return new URL(text).protocol === 'https:' ? text : null;
  } catch {
    return null;
  }
}

/** The Google Maps address that searches a point. A site visit with a project pin opens it. */
export function mapsLink(point: GeoPoint): string {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;
}

export type MainAction = { kind: 'join' | 'maps'; href: string };

type Timed = { startsAt: string; endsAt: string; status: 'scheduled' | 'cancelled'; kind: string; where: string };

/**
 * The one main button of the meeting sheet. "Join": the place is a link, and the meeting starts in 30 minutes or less or is in
 * progress. "Open in Google Maps": a site visit that has not ended and a project pin. Else none. A cancelled or finished meeting
 * has no main button.
 */
export function mainAction(meeting: Timed, at: Date, pin: GeoPoint | null): MainAction | null {
  const phase = phaseOf(meeting, at);
  if (phase === 'cancelled' || phase === 'done') return null;
  const link = joinLink(meeting.where);
  const soon = Date.parse(meeting.startsAt) - at.getTime() <= JOIN_LEAD_MIN * 60_000;
  if (link && (phase === 'now' || soon)) return { kind: 'join', href: link };
  if (meeting.kind === 'site_visit' && pin) return { kind: 'maps', href: mapsLink(pin) };
  return null;
}
