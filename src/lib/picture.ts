import { PICTURE_DATA } from '../api/contract/limits';

/**
 * The profile picture (owner item 10, 2026-10-05): the browser cuts the centre square, makes it 128 px, and saves it as WebP
 * (JPEG where the browser cannot make WebP), at most 16 KB, as a data address in avatarUrl. No file store holds it.
 * A picture with see-through parts keeps them (owner, fbk_019, 2026-10-18): it gets no white ground, and it is saved as WebP,
 * or as PNG where the browser cannot make WebP. The glow of the person shows through those parts (Avatar.tsx).
 */
export const PICTURE_SIDE = 128;
export const PICTURE_MAX_BYTES = 16 * 1024;
const QUALITIES = [0.85, 0.75, 0.65, 0.5, 0.35] as const;
/** The sides that a PNG tries, from the largest. A PNG is big, so a smaller side may fit where 128 px does not. */
const PNG_SIDES = [128, 112, 96, 80, 64] as const;

/** "cover" cuts the centre square (the default). "contain" fits the whole picture inside the square. */
export type PictureFit = 'cover' | 'contain';

export interface PictureOptions {
  fit?: PictureFit;
}

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

/**
 * The whole picture inside the square of PICTURE_SIDE ("contain"): where it starts, and its width and height. The longest
 * side fills the square. The space around the picture stays see-through.
 */
export function containSquare(width: number, height: number): { dx: number; dy: number; w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= 0) return { dx: 0, dy: 0, w: 0, h: 0 };
  const scale = PICTURE_SIDE / longest;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { dx: Math.round((PICTURE_SIDE - w) / 2), dy: Math.round((PICTURE_SIDE - h) / 2), w, h };
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

/**
 * The best PNG that fits in 16 KB, for a picture with see-through parts on a browser that cannot make WebP. "encode" draws
 * the picture at one side and gives its data address. The first side that fits wins. Null when no side fits.
 */
export function encodePngSmallest(encode: (side: number) => string): string | null {
  for (const side of PNG_SIDES) {
    const url = encode(side);
    if (bytesOfDataUrl(url) <= PICTURE_MAX_BYTES && PICTURE_DATA.test(url)) return url;
  }
  return null;
}

/** True when one pixel of the RGBA data is see-through. An alpha under 250 counts, so a nearly opaque edge does not. */
export function hasSeeThrough(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 250) return true;
  }
  return false;
}

/**
 * The saved type of a picture. WebP keeps see-through parts, so it comes first when the browser makes it. Without WebP, a
 * picture with see-through parts becomes PNG, and a picture without them becomes JPEG.
 */
export function pictureType(canWebp: boolean, seeThrough: boolean): 'webp' | 'png' | 'jpeg' {
  if (canWebp) return 'webp';
  return seeThrough ? 'png' : 'jpeg';
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

/** The canvas context of a canvas. A browser that gives none cannot make the picture. */
function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new PictureError('unreadable');
  return context;
}

/** A square canvas of one side with the picture drawn on it. A white ground is painted first only when asked. */
function squareOf(source: CanvasImageSource, width: number, height: number, side: number, fit: PictureFit, whiteGround: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = contextOf(canvas);
  context.imageSmoothingQuality = 'high';
  if (whiteGround) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, side, side);
  }
  const scale = side / PICTURE_SIDE;
  if (fit === 'contain') {
    const { dx, dy, w, h } = containSquare(width, height);
    context.drawImage(source, 0, 0, width, height, dx * scale, dy * scale, w * scale, h * scale);
  } else {
    const { sx, sy, side: cut } = centreSquare(width, height);
    context.drawImage(source, sx, sy, cut, cut, 0, 0, side, side);
  }
  return canvas;
}

/**
 * Makes the profile picture of a file: 128 px, WebP, JPEG or PNG, at most 16 KB, as a data address. "cover" (the default)
 * cuts the centre square. "contain" fits the whole picture inside it. See-through parts stay see-through.
 */
export async function pictureOf(file: File, options: PictureOptions = {}): Promise<string> {
  const fit = options.fit ?? 'cover';
  let image: Awaited<ReturnType<typeof decode>>;
  try {
    image = await decode(file);
  } catch {
    throw new PictureError('unreadable');
  }
  try {
    if (image.width === 0 || image.height === 0) throw new PictureError('unreadable');
    const { source, width, height } = image;
    // The picture is drawn on a clear canvas first. Its alpha values show the see-through parts. "contain" adds see-through space.
    const clear = squareOf(source, width, height, PICTURE_SIDE, fit, false);
    const seeThrough = hasSeeThrough(contextOf(clear).getImageData(0, 0, PICTURE_SIDE, PICTURE_SIDE).data);
    // A picture with no see-through parts gets a white ground, so it can become JPEG.
    const canvas = seeThrough ? clear : squareOf(source, width, height, PICTURE_SIDE, fit, true);
    const canWebp = canvas.toDataURL('image/webp').startsWith('data:image/webp;');
    const url =
      pictureType(canWebp, seeThrough) === 'png'
        ? encodePngSmallest((side) => squareOf(source, width, height, side, fit, false).toDataURL('image/png'))
        : encodeSmallest((type, quality) => canvas.toDataURL(type, quality));
    if (!url) throw new PictureError('too_big');
    return url;
  } finally {
    image.done();
  }
}
