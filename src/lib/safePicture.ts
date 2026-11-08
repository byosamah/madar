import { PICTURE_DATA } from '../api/contract/limits';

/**
 * The picture when it is safe to show: picture data or an https address. Every other value gives null. It has its own file because the faces and the logos of
 * the first screen need only this check, and src/lib/picture.ts holds the canvas code that makes a picture. The first load must not carry that code.
 */
export function safePicture(url: string | null | undefined): string | null {
  if (!url) return null;
  return PICTURE_DATA.test(url) || /^https:\/\/[^\s]+$/.test(url) ? url : null;
}
