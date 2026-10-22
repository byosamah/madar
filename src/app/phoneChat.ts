/** The address of one open chat. On a phone it is a full screen with no tab bar and no top row. */
export const PHONE_CHAT = /^\/inbox\/[^/]+$/;

export function isPhoneChatPath(pathname: string): boolean {
  return PHONE_CHAT.test(pathname);
}
