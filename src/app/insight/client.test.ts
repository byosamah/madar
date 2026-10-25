import { describe, expect, it } from 'vitest';
import { posthogOptions } from './client';

const options = (person: () => { id: string; name: string } | null = () => ({ id: 'usr_1', name: 'Alice' })) =>
  posthogOptions({ env: 'test', build: '2026.10.25', person });

const result = (event: string, properties: Record<string, unknown> = {}) => ({ uuid: 'u', event, properties });

function beforeSend(o = options()) {
  const fn = o.before_send;
  if (typeof fn !== 'function') throw new Error('before_send must be one function');
  return fn;
}

describe('posthogOptions', () => {
  it('sends to PostHog Cloud EU and keeps its ids in sessionStorage with no person profile', () => {
    const o = options();
    expect(o.api_host).toBe('https://eu.i.posthog.com');
    expect(o.person_profiles).toBe('identified_only');
    expect(o.persistence).toBe('sessionStorage');
    expect(o.save_referrer).toBe(false);
    expect(o.save_campaign_params).toBe(false);
  });

  it('loads nothing from another host and turns off what Madar does not use', () => {
    const o = options();
    expect(o.disable_external_dependency_loading).toBe(true);
    expect(o.disable_surveys).toBe(true);
    expect(o.disable_conversations).toBe(true);
    expect(o.disable_product_tours).toBe(true);
    expect(o.disable_web_experiments).toBe(true);
    expect(o.capture_heatmaps).toBe(false);
    expect(o.capture_dead_clicks).toBe(false);
  });

  it('captures clicks, leaves, errors and the web vitals, but no automatic page view and no network timing', () => {
    const o = options();
    expect(o.autocapture).toEqual({ dom_event_allowlist: ['click'], capture_copied_text: false });
    expect(o.capture_pageview).toBe(false);
    expect(o.capture_pageleave).toBe(true);
    expect(o.capture_exceptions).toBe(true);
    expect(o.capture_performance).toEqual({ network_timing: false, web_vitals: true });
  });

  it('masks every input in a replay and records no console, header or body', () => {
    const o = options();
    expect(o.enable_recording_console_log).toBe(false);
    expect(o.session_recording).toMatchObject({ maskAllInputs: true, recordHeaders: false, recordBody: false, blockClass: 'ph-no-capture' });
  });

  it('scrubs each record and adds env and build to it', () => {
    const out = beforeSend()(result('$pageview', { $current_url: 'https://madar.vado.sa/search?q=secret' }));
    expect(out?.properties).toMatchObject({ $current_url: 'https://madar.vado.sa/search', env: 'test', build: '2026.10.25' });
  });

  it('adds the person to an $exception record only', () => {
    const send = beforeSend();
    expect(send(result('$exception', { $exception_message: 'x' }))?.properties).toMatchObject({ personId: 'usr_1', personName: 'Alice' });
    for (const event of ['$pageview', '$autocapture', 'madar_refused', '$snapshot', '$web_vitals']) {
      const properties = send(result(event))?.properties ?? {};
      expect(properties, event).not.toHaveProperty('personId');
      expect(properties, event).not.toHaveProperty('personName');
    }
  });

  it('drops the harmless ResizeObserver loop warning, and keeps every other error (test copy, 2026-10-25)', () => {
    const send = beforeSend();
    const warning = (value: string) => result('$exception', { $exception_list: [{ type: 'Error', value }] });
    expect(send(warning('ResizeObserver loop completed with undelivered notifications.'))).toBeNull();
    expect(send(warning('ResizeObserver loop limit exceeded'))).toBeNull();
    expect(send(result('$exception', { $exception_message: 'ResizeObserver loop limit exceeded' }))).toBeNull();
    expect(send(warning('Cannot read properties of undefined (reading \'name\')'))).not.toBeNull();
    expect(send(result('$pageview', { note: 'ResizeObserver loop' }))).not.toBeNull();
  });

  it('adds no person to an error when no person is known', () => {
    const out = beforeSend(options(() => null))(result('$exception'));
    expect(out?.properties).not.toHaveProperty('personId');
  });

  it('drops a record that the scrub cannot read', () => {
    const properties: Record<string, unknown> = {};
    Object.defineProperty(properties, 'bad', { enumerable: true, get() { throw new Error('boom'); } });
    expect(beforeSend()({ uuid: 'u', event: '$pageview', properties })).toBeNull();
  });

  it('drops every record while the client is stopped', () => {
    let active = true;
    const send = beforeSend(posthogOptions({ env: 'test', build: '1', person: () => null, active: () => active }));
    expect(send(result('$pageview'))).not.toBeNull();
    active = false;
    expect(send(result('$pageview'))).toBeNull();
  });

  it('never throws when the person reader throws', () => {
    const out = beforeSend(options(() => { throw new Error('boom'); }))(result('$exception'));
    expect(out).not.toBeNull();
    expect(out?.properties).not.toHaveProperty('personId');
  });
});
