import { afterEach, describe, expect, it, vi } from 'vitest';
import { androidBrowser, installEvent, iphoneBrowser, stopPushBrowser } from '../../test/pushBrowser';
import { canInstall, isAndroid, onInstallChange, promptInstall, watchInstall } from './install';

/** The Android install of Madar (owner, 2026-10-20): the page keeps the install event of Chrome for the one button on Home. */

let stop: () => void = () => undefined;

afterEach(() => {
  stop();
  stopPushBrowser();
});

describe('isAndroid', () => {
  it('is true for Android only', () => {
    expect(isAndroid('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')).toBe(true);
    expect(isAndroid('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe(false);
    expect(isAndroid('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});

describe('watchInstall', () => {
  it('keeps the event of Chrome on Android, stops the bar of Chrome, and tells the listeners', () => {
    androidBrowser();
    stop = watchInstall();
    const told = vi.fn();
    const off = onInstallChange(told);
    const event = installEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);
    expect(told).toHaveBeenCalledTimes(1);
    off();
  });

  it('does nothing on a system that is not Android, so a computer keeps the install icon of Chrome', () => {
    stop = watchInstall();
    const event = installEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(canInstall()).toBe(false);
  });

  it('does nothing on an iPhone, which sends no such event anyway', () => {
    iphoneBrowser();
    stop = watchInstall();
    window.dispatchEvent(installEvent());
    expect(canInstall()).toBe(false);
  });

  it('forgets the event once Madar is on the Home Screen', () => {
    androidBrowser();
    stop = watchInstall();
    window.dispatchEvent(installEvent());
    window.dispatchEvent(new Event('appinstalled'));
    expect(canInstall()).toBe(false);
  });

  it('forgets the event when it stops', () => {
    androidBrowser();
    stop = watchInstall();
    window.dispatchEvent(installEvent());
    stop();
    expect(canInstall()).toBe(false);
  });
});

describe('promptInstall', () => {
  it('opens the install box of Chrome inside the tap, gives the answer, and uses the event once', async () => {
    androidBrowser();
    stop = watchInstall();
    const event = installEvent('dismissed');
    window.dispatchEvent(event);
    const answer = promptInstall();
    // The box opens before any wait: Chrome refuses a prompt outside the tap.
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(canInstall()).toBe(false);
    expect(await answer).toBe('dismissed');
    expect(await promptInstall()).toBe('none');
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('gives "none" when the box cannot open', async () => {
    androidBrowser();
    stop = watchInstall();
    const event = installEvent();
    event.prompt.mockRejectedValueOnce(new DOMException('The prompt was used.', 'InvalidStateError'));
    window.dispatchEvent(event);
    expect(await promptInstall()).toBe('none');
    expect(canInstall()).toBe(false);
  });
});
