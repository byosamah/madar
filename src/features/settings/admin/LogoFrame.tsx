import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkForm } from '../../../components/ProjectTile';
import { LOGO_PLATE } from '../../../components/SubCompanyLogo';
import { markGlow } from '../../../lib/projectMark';
import { cropPreview, MAX_ZOOM, type PictureCrop } from '../../../lib/picture';

/** The side of the big frame circle, in pixels. */
const FRAME = 160;
/** The sizes of the preview circles: the badge of a small tile, and two larger places. */
const PREVIEW_SIZES = [18, 22, 28] as const;
/** One arrow key moves the picture by this share of its width. */
const NUDGE = 0.04;

type Natural = { width: number; height: number };

/** One circle with the logo placed by the crop, on the white plate that every logo gets. Without a size, the whole picture fits. */
function CropCircle({ src, natural, crop, side }: { src: string; natural: Natural | null; crop: PictureCrop; side: number }) {
  const place = natural ? cropPreview(natural.width, natural.height, crop, side) : null;
  return (
    <span style={{ width: side, height: side, background: LOGO_PLATE }} className="relative inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-ink/10">
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

/**
 * The frame step of a new logo (PRJ-11, 2026-10-19). The Admin drags the picture inside a circle and zooms with a slider, so the
 * mark fills the circle. A row below shows the logo at the sizes of the lists, beside a sample project tile, so the Admin sees before
 * Save what everyone will see. The parent saves the picture again from the crop.
 */
export function LogoFrame({ file, crop, onCrop }: { file: File; crop: PictureCrop; onCrop: (crop: PictureCrop) => void }) {
  const { t } = useTranslation();
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
    <div role="group" aria-label={t('subCompanies.frame')} className="flex flex-col gap-3">
      <p className="text-footnote text-ink-2">{t('subCompanies.frameHint')}</p>
      <div className="flex justify-center">
        <div
          role="img"
          aria-label={t('subCompanies.frameHint')}
          tabIndex={0}
          style={{ width: FRAME, height: FRAME, background: LOGO_PLATE, touchAction: 'none' }}
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
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            style={place ? { position: 'absolute', width: place.width, height: place.height, left: place.left, top: place.top, maxWidth: 'none' } : undefined}
            className={place ? 'select-none' : 'size-full object-contain'}
          />
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-footnote font-semibold text-ink-2">
        {t('subCompanies.zoom')}
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.05}
          value={crop.zoom}
          aria-label={t('subCompanies.zoom')}
          onChange={(event) => onCrop({ ...crop, zoom: Number(event.target.value) })}
          className="min-w-0 flex-1 accent-[var(--sig-from)]"
        />
      </label>
      <div className="flex flex-col gap-2">
        <p className="text-footnote font-semibold text-ink-2">{t('subCompanies.preview')}</p>
        <div className="flex items-center gap-4">
          {/* A sample project tile with the badge at its real place and size. */}
          <span className="relative inline-flex shrink-0" style={{ width: 34, height: 34 }} aria-hidden>
            <span style={{ width: 34, height: 34, background: markGlow('prj_000', 3) }} className="grid place-items-center rounded-[30%] ring-1 ring-inset ring-ink/10">
              <MarkForm mark={3} className="size-[45%]" />
            </span>
            <span style={{ insetBlockEnd: -9, insetInlineEnd: -9, boxShadow: '0 0 0 2px var(--c-panel)' }} className="absolute rounded-full">
              <CropCircle src={src} natural={natural} crop={crop} side={PREVIEW_SIZES[0]} />
            </span>
          </span>
          {PREVIEW_SIZES.slice(1).map((side) => <CropCircle key={side} src={src} natural={natural} crop={crop} side={side} />)}
        </div>
      </div>
    </div>
  );
}
