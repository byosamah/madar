import { PICTURE_DATA } from '../api/contract/limits';

/**
 * The profile picture (owner item 10, 2026-10-05): the browser cuts the centre square, makes it 128 px, and saves it as WebP
 * (JPEG where the browser cannot make WebP), at most 16 KB, as a data address in avatarUrl. No file store holds it.
 */
export const PICTURE_SIDE = 128;
export const PICTURE_MAX_BYTES = 16 * 1024;
const QUALITIES = [0.85, 0.75, 0.65, 0.5, 0.35] as const;

/** The picture when it is safe to show: picture data or an https address. Every other value gives null. */
export function safePicture(url: string | null | undefined): string | null {
  if (!url) return null;
  return PICTURE_DATA.test(url) || /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

/** The centre square of a picture: where it starts and how long its side is. */
export function centreSquare(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height);
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), side };
}

/** The number of bytes that the base64 data of a data address holds. */
export function bytesOfDataUrl(url: string): number {
  const data = url.slice(url.indexOf(',') + 1);
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length * 3) / 4 - padding;
}

/**
 * The best picture that fits in 16 KB. "encode" gives a data address for a type and a quality, as canvas.toDataURL does.
 * A browser that cannot make WebP gives PNG for it: then the picture is JPEG. Null when no quality fits.
 */
export function encodeSmallest(encode: (type: 'image/webp' | 'image/jpeg', quality: number) => string): string | null {
  let type: 'image/webp' | 'image/jpeg' = 'image/webp';
  for (const quality of QUALITIES) {
    let url = encode(type, quality);
    if (type === 'image/webp' && !url.startsWith('data:image/webp;')) {
      type = 'image/jpeg';
      url = encode(type, quality);
    }
    if (bytesOfDataUrl(url) <= PICTURE_MAX_BYTES && PICTURE_DATA.test(url)) return url;
  }
  return null;
}

/** Opens a picture file as something a canvas can draw: an ImageBitmap where the browser has one, else an image element. */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
    } catch {
      // Some browsers cannot make a bitmap of some types. The image element below tries again.
    }
  }
  const address = URL.createObjectURL(file);
  const image = new Image();
  image.src = address;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(address);
    throw error;
  }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, done: () => URL.revokeObjectURL(address) };
}

/** The reasons why a picture cannot be made: the file is not a picture the browser reads, or it does not fit in 16 KB. */
export class PictureError extends Error {
  constructor(readonly reason: 'unreadable' | 'too_big') {
    super(reason === 'unreadable' ? 'Madar cannot read this picture.' : 'The picture does not fit in 16 KB.');
    this.name = 'PictureError';
  }
}

/** Makes the profile picture of a file: the centre square, 128 px, WebP or JPEG, at most 16 KB, as a data address. */
export async function pictureOf(file: File): Promise<string> {
  let image: Awaited<ReturnType<typeof decode>>;
  try {
    image = await decode(file);
  } catch {
    throw new PictureError('unreadable');
  }
  try {
    if (image.width === 0 || image.height === 0) throw new PictureError('unreadable');
    const canvas = document.createElement('canvas');
    canvas.width = PICTURE_SIDE;
    canvas.height = PICTURE_SIDE;
    const context = canvas.getContext('2d');
    if (!context) throw new PictureError('unreadable');
    const { sx, sy, side } = centreSquare(image.width, image.height);
    context.imageSmoothingQuality = 'high';
    // A white ground first: a PNG with see-through parts becomes JPEG on some browsers, and JPEG has no see-through parts.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PICTURE_SIDE, PICTURE_SIDE);
    context.drawImage(image.source, sx, sy, side, side, 0, 0, PICTURE_SIDE, PICTURE_SIDE);
    const url = encodeSmallest((type, quality) => canvas.toDataURL(type, quality));
    if (!url) throw new PictureError('too_big');
    return url;
  } finally {
    image.done();
  }
}
