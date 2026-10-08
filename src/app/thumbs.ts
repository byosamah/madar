/** The long side of a small picture, in pixels (plan 5.2). */
export const THUMB_EDGE = 960;

/** The quality of the small picture, in WebP and in JPEG. */
const QUALITY = 0.8;

/**
 * The small picture of an image for the file lists and the cards: a WebP of at most 960 px on the long side, made in the browser
 * before the upload. A browser that cannot write WebP gives a JPEG for a JPEG photo. It gives null when the file is not a
 * picture, is a drawing (SVG), or the browser cannot read it or cannot write the type. The upload then goes without a small
 * picture, and the lists show the full picture.
 */
export async function makeThumb(file: Blob): Promise<Blob | null> {
  if (!file.type.startsWith('image/') || file.type.startsWith('image/svg')) return null;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const pen = canvas.getContext('2d');
    if (!pen) return null;
    pen.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = (type: 'image/webp' | 'image/jpeg') => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
    const thumb = await encode('image/webp');
    if (thumb && thumb.type === 'image/webp') return thumb;
    // A browser that cannot write WebP (Safari, and every browser on an iPhone or iPad) gives a PNG instead, which can be larger
    // than the original. A JPEG photo then gets a JPEG small picture, when it is smaller than the photo (performance audit
    // BGR-M1). Every other picture gets none: a PNG or a GIF can have clear parts, and a JPEG turns them black.
    if (file.type !== 'image/jpeg') return null;
    const jpeg = await encode('image/jpeg');
    return jpeg && jpeg.type === 'image/jpeg' && jpeg.size < file.size ? jpeg : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
