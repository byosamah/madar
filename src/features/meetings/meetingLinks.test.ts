import { describe, expect, it } from 'vitest';
import { JOIN_LEAD_MIN, joinLink, mainAction, mapsLink } from './meetingLinks';

/** The links and the main button of a meeting (fbk_022). A place that starts with https:// is a link. */
describe('joinLink', () => {
  it('gives the text of a place that starts with https://', () => {
    expect(joinLink('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(joinLink('  https://zoom.us/j/123  ')).toBe('https://zoom.us/j/123');
  });

  it('gives null for a place that is not one link', () => {
    expect(joinLink('Client office, Al Khobar')).toBeNull();
    expect(joinLink('http://meet.example.com/a')).toBeNull();
    expect(joinLink('javascript:alert(1)')).toBeNull();
    expect(joinLink('https://meet.example.com/a and the lobby')).toBeNull();
    expect(joinLink('')).toBeNull();
  });
});

describe('mapsLink', () => {
  it('writes the Google Maps search address of a point', () => {
    expect(mapsLink({ lat: 26.3, lng: 50.2 })).toBe('https://www.google.com/maps/search/?api=1&query=26.3,50.2');
  });
});

describe('mainAction', () => {
  const at = new Date('2026-10-20T07:00:00Z');
  const meeting = (o: Partial<{ startsAt: string; endsAt: string; status: 'scheduled' | 'cancelled'; kind: 'meeting' | 'site_visit'; where: string }> = {}) => ({
    startsAt: '2026-10-20T11:00:00.000+03:00', endsAt: '2026-10-20T12:00:00.000+03:00', status: 'scheduled' as const, kind: 'meeting' as const,
    where: 'https://meet.example.com/a', ...o,
  });

  it('shows Join when the place is a link and the start is in 30 minutes or less', () => {
    expect(JOIN_LEAD_MIN).toBe(30);
    // 10:30 office time is 30 minutes before the start.
    expect(mainAction(meeting(), new Date('2026-10-20T07:30:00Z'), null)).toEqual({ kind: 'join', href: 'https://meet.example.com/a' });
    expect(mainAction(meeting(), new Date('2026-10-20T07:29:59Z'), null)).toBeNull();
  });

  it('shows Join while the meeting is in progress, and not after the end', () => {
    expect(mainAction(meeting(), new Date('2026-10-20T08:30:00Z'), null)?.kind).toBe('join');
    expect(mainAction(meeting(), new Date('2026-10-20T09:00:00Z'), null)).toBeNull();
  });

  it('shows no button for a link when the meeting is cancelled', () => {
    expect(mainAction(meeting({ status: 'cancelled' }), new Date('2026-10-20T08:30:00Z'), null)).toBeNull();
  });

  it('shows Open in Google Maps for a site visit with a project pin', () => {
    const visit = meeting({ kind: 'site_visit', where: 'The plot' });
    expect(mainAction(visit, at, { lat: 26.3, lng: 50.2 })).toEqual({ kind: 'maps', href: 'https://www.google.com/maps/search/?api=1&query=26.3,50.2' });
    expect(mainAction(visit, at, null)).toBeNull();
  });

  it('puts Join before Maps, so a meeting has one main button', () => {
    const visit = meeting({ kind: 'site_visit' });
    expect(mainAction(visit, new Date('2026-10-20T08:30:00Z'), { lat: 26.3, lng: 50.2 })?.kind).toBe('join');
  });

  it('shows no Maps button for a past or a cancelled site visit', () => {
    const pin = { lat: 26.3, lng: 50.2 };
    expect(mainAction(meeting({ kind: 'site_visit', where: '', status: 'cancelled' }), at, pin)).toBeNull();
    expect(mainAction(meeting({ kind: 'site_visit', where: '' }), new Date('2026-10-20T10:00:00Z'), pin)).toBeNull();
  });

  it('shows no button for another kind or a place that is plain text', () => {
    expect(mainAction(meeting({ where: 'Meeting room' }), at, { lat: 26.3, lng: 50.2 })).toBeNull();
  });
});
