import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cropPreview, fillCrop, MAX_ZOOM, type PictureCrop } from '../lib/picture';

/** The side of the big frame circle, in pixels. */
const FRAME = 160;
/** One arrow key moves the picture by this share of its width. */
const NUDGE = 0.04;

type Natural = { width: number; height: number };

/**
 * One circle with the picture placed by the crop, on a plate. `plate` is the CSS background that shows through the see-through parts:
 * the white plate of a logo, or the glow of a person. Without a size of the picture, the whole picture fits.
 */
export function CropCircle({ src, natural, crop, side, plate }: { src: string; natural: Natural | null; crop: PictureCrop; side: number; plate: string }) {
  const place = natural ? cropPreview(natural.width, natural.height, crop, side) : null;
  return (
    <span style={{ width: side, height: side, background: plate }} className="relative inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-ink/10">
      <img
        src={src}
        alt=""
        draggable={false}
        style={place ? { position: 'absolute', width: place.width, height: place.height, left: place.left, top: place.top, maxWidth: 'none' } : undefined}
        className={place ? '' : 'size-full object-contain'}
      />
    </span>
  );
}

/** The words of one frame step: the name of the group, the hint, the zoom slider and the heading of the preview. */
export type FrameWords = { group: string; hint: string; zoom: string; preview: string };

/**
 * The frame step of a picture (a sub-company logo, PRJ-11, 2026-10-19; a profile picture, fbk_029, 2026-10-23). The person drags the
 * picture inside a circle and zooms with a slider. A row below shows the result at the sizes where the picture appears, so the person
 * sees before Save what everyone will see. The parent saves the picture again from the crop (pictureOf with the crop).
 *
 * - `plate`: the background that shows through the see-through parts of the picture.
 * - `previews`: the row under the preview heading. It gets `circle(side)`, which draws the picture in a circle of that size.
 * - `start`: "whole" shows the whole picture first (a logo). "fill" shows the centre square first (a profile picture), as the picture
 *   always was before it had a frame; the crop is set when the browser has loaded the picture and told its size.
 * - `onUnreadable`: the browser could not load the picture, so there is nothing to frame.
 */
export function PictureFrame({ file, crop, onCrop, plate, words, previews, start = 'whole', onUnreadable }: {
  file: File;
  crop: PictureCrop;
  onCrop: (crop: PictureCrop) => void;
  plate: string;
  words: FrameWords;
  previews: (circle: (side: number) => ReactNode) => ReactNode;
  start?: 'whole' | 'fill';
  onUnreadable?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<Natural | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // The browser shows the file through an address that this step makes and frees. A test browser may have no such address.
  useEffect(() => {
    setNatural(null);
    if (typeof URL.createObjectURL !== 'function') return undefined;
    const address = URL.createObjectURL(file);
    setSrc(address);
    return () => {
      setSrc(null);
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(address);
    };
  }, [file]);

  if (!src) return null;
  const move = (dx: number, dy: number) => {
    if (!natural) return;
    const place = cropPreview(natural.width, natural.height, crop, FRAME);
    onCrop({ ...crop, cx: crop.cx - dx / place.width, cy: crop.cy - dy / place.height });
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    move(event.clientX - drag.current.x, event.clientY - drag.current.y);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = (FRAME * NUDGE) / Math.max(1, crop.zoom);
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const arrow = arrows[event.key];
    if (!arrow) return;
    event.preventDefault();
    move(arrow[0], arrow[1]);
  };
  const place = natural ? cropPreview(natural.width, natural.height, crop, FRAME) : null;
  return (
    <div role="group" aria-label={words.group} className="flex flex-col gap-3">
      <p className="text-footnote text-ink-2">{words.hint}</p>
      <div className="flex justify-center">
        <div
          role="img"
          aria-label={words.hint}
          tabIndex={0}
          style={{ width: FRAME, height: FRAME, background: plate, touchAction: 'none' }}
          className="relative cursor-grab overflow-hidden rounded-full ring-1 ring-inset ring-ink/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onKeyDown={onKeyDown}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
              setNatural(size);
              if (start === 'fill') onCrop(fillCrop(size.width, size.height));
            }}
            onError={onUnreadable}
            style={place ? { position: 'absolute', width: place.width, height: place.height, left: place.left, top: place.top, maxWidth: 'none' } : undefined}
            className={place ? 'select-none' : 'size-full object-contain'}
          />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-footnote font-semibold text-ink-2">
        {words.zoom}
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.05}
          value={crop.zoom}
          aria-label={words.zoom}
          onChange={(event) => onCrop({ ...crop, zoom: Number(event.target.value) })}
          className="min-w-0 flex-1 accent-[var(--sig-from)]"
        />
      </label>
      <div className="flex flex-col gap-2">
        <p className="text-footnote font-semibold text-ink-2">{words.preview}</p>
        <div className="flex items-center gap-4">
          {previews((side) => <CropCircle key={side} src={src} natural={natural} crop={crop} side={side} plate={plate} />)}
        </div>
      </div>
    </div>
  );
}
