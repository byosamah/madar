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
    expect(out.properties).toEqual({
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
    expect(out.properties?.$exception_message).toBe('Failed https://f.test/k');
    expect(out.properties?.$exception_list).toEqual([{ type: 'Error', value: 'Load https://f.test/k failed' }, { type: 'Error', value: 'plain' }]);
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
    expect(out.properties?.$snapshot_data).toEqual([
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
    expect((out.properties?.$elements as { attr__href: string }[])[0]!.attr__href).toBe('/projects/prj_1');
    expect(String(out.properties?.$elements_chain)).not.toContain('task=t1');
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
});
