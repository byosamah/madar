import { describe, expect, it } from 'vitest';
import { scrubEvent } from './scrub';

describe('scrubEvent', () => {
  it('scrubs the address properties and keeps the others', () => {
    const out = scrubEvent({
      event: '$pageview',
      properties: {
        $current_url: 'https://madar.vado.sa/projects/prj_1?tab=files&task=t#x',
        $referrer: 'https://madar.vado.sa/search?q=secret',
        $initial_current_url: 'https://madar.vado.sa/settings#google=finish&code=abc&state=def',
        $initial_referrer: 'https://x.test/a?b=1',
        $pathname: '/projects/prj_1',
        screen: 'project',
      },
    });
    expect(out!.properties).toEqual({
      $current_url: 'https://madar.vado.sa/projects/prj_1?tab=files',
      $referrer: 'https://madar.vado.sa/search',
      $initial_current_url: 'https://madar.vado.sa/settings',
      $initial_referrer: 'https://x.test/a',
      $pathname: '/projects/prj_1',
      screen: 'project',
    });
  });

  it('scrubs an address inside an error message', () => {
    const out = scrubEvent({
      event: '$exception',
      properties: {
        $exception_message: 'Failed https://f.test/k?X-Amz-Signature=1',
        $exception_list: [{ type: 'Error', value: 'Load https://f.test/k?X-Amz-Signature=1 failed' }, { type: 'Error', value: 'plain' }],
      },
    });
    expect(out!.properties?.$exception_message).toBe('Failed https://f.test/k');
    expect(out!.properties?.$exception_list).toEqual([{ type: 'Error', value: 'Load https://f.test/k failed' }, { type: 'Error', value: 'plain' }]);
  });

  it('scrubs the href of a replay Meta item (type 4) only', () => {
    const out = scrubEvent({
      event: '$snapshot',
      properties: {
        $snapshot_data: [
          { type: 4, data: { href: 'https://madar.vado.sa/inbox?chat=c1#m', width: 390, height: 800 } },
          { type: 3, data: { href: 'https://madar.vado.sa/inbox?chat=c1' } },
        ],
      },
    });
    expect(out!.properties?.$snapshot_data).toEqual([
      { type: 4, data: { href: 'https://madar.vado.sa/inbox', width: 390, height: 800 } },
      { type: 3, data: { href: 'https://madar.vado.sa/inbox?chat=c1' } },
    ]);
  });

  it('scrubs the href of an autocapture element', () => {
    const out = scrubEvent({
      event: '$autocapture',
      properties: {
        $elements: [{ tag_name: 'a', attr__href: '/projects/prj_1?task=t1' }],
        $elements_chain: 'a:attr__href="/projects/prj_1?task=t1"nth-child="1"',
      },
    });
    expect((out!.properties?.$elements as { attr__href: string }[])[0]!.attr__href).toBe('/projects/prj_1');
    expect(String(out!.properties?.$elements_chain)).not.toContain('task=t1');
  });

  it('does not change its input', () => {
    const input = { event: '$pageview', properties: { $current_url: 'https://madar.vado.sa/a?b=1' } };
    scrubEvent(input);
    expect(input.properties.$current_url).toBe('https://madar.vado.sa/a?b=1');
  });

  it('gives a wrong shape back as it is and never throws', () => {
    const odd = { event: '$exception', properties: { $exception_list: 'text', $snapshot_data: 4, $current_url: 5 } };
    expect(scrubEvent(odd)).toEqual(odd);
    const bare = { event: 'x' };
    expect(scrubEvent(bare)).toEqual(bare);
  });

  it('scrubs a nested address and the keys that no list names', () => {
    const out = scrubEvent({
      event: '$web_vitals',
      properties: {
        $web_vitals_LCP_event: { $current_url: 'https://madar.vado.sa/search?q=x', name: 'LCP' },
        $session_entry_url: 'https://madar.vado.sa/inbox?chat=c1#m',
        $session_entry_referrer: 'HTTPS://X.test/a?b=1',
        $prev_pageview_url: '/projects/prj_1?task=t1',
        $session_entry_pathname: '/tasks?filter=mine',
        note: 'https://madar.vado.sa/a?b=1',
        other: '/not-a-url?kept',
        list: [{ deep: { href: '?q=secret' } }],
      },
    });
    expect(out!.properties).toEqual({
      $web_vitals_LCP_event: { $current_url: 'https://madar.vado.sa/search', name: 'LCP' },
      $session_entry_url: 'https://madar.vado.sa/inbox',
      $session_entry_referrer: 'https://x.test/a',
      $prev_pageview_url: '/projects/prj_1',
      $session_entry_pathname: '/tasks',
      note: 'https://madar.vado.sa/a',
      other: '/not-a-url?kept',
      list: [{ deep: { href: '' } }],
    });
  });

  it('scrubs $set and $set_once at the event level and in the properties', () => {
    const out = scrubEvent({
      event: '$pageview',
      $set_once: { $initial_current_url: 'https://madar.vado.sa/settings#google=finish&code=abc' },
      $set: { $current_url: 'https://madar.vado.sa/search?q=x' },
      properties: {
        $set_once: { $initial_referrer: 'https://x.test/a?b=1' },
        $set: { $current_url: 'https://madar.vado.sa/search?q=y' },
      },
    } as { event: string; properties: Record<string, unknown>; $set: unknown; $set_once: unknown });
    expect(out!.$set_once).toEqual({ $initial_current_url: 'https://madar.vado.sa/settings' });
    expect(out!.$set).toEqual({ $current_url: 'https://madar.vado.sa/search' });
    expect(out!.properties).toEqual({ $set_once: { $initial_referrer: 'https://x.test/a' }, $set: { $current_url: 'https://madar.vado.sa/search' } });
  });

  it('scrubs the strings of an exception list down to the frames', () => {
    const out = scrubEvent({
      event: '$exception',
      properties: {
        $exception_list: [{ type: 'Error', value: 'Failed https://f.test/k?sig=1', stacktrace: { frames: [{ filename: 'https://madar.vado.sa/assets/a.js?v=2', lineno: 1 }] } }],
      },
    });
    expect(JSON.stringify(out)).not.toContain('sig=1');
    expect(JSON.stringify(out)).not.toContain('v=2');
  });

  it('fails closed: a record that cannot be read gives null', () => {
    const properties: Record<string, unknown> = { $current_url: 'https://madar.vado.sa/a?b=1' };
    Object.defineProperty(properties, 'bad', { enumerable: true, get() { throw new Error('boom'); } });
    expect(scrubEvent({ event: '$pageview', properties })).toBeNull();
  });
});
