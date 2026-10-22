import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'vaul';
import { usePanelOpen } from '../app/panelOpen';
import { isToastPress, useSheetToasts } from '../app/toasts';
import { AnimatedIcon } from './icons/AnimatedIcon';
import { ChevronLeftIcon } from './icons/animated/chevron-left';
import { ChevronRightIcon } from './icons/animated/chevron-right';
import { DownloadIcon } from './icons/animated/download';
import { XIcon } from './icons/animated/x';
import { useImageZoom } from './useImageZoom';

type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

/**
 * True when a press lands on the picture itself. The picture fills its box and keeps its shape (object-fit: contain), so it leaves
 * dark space above and below, or at both sides. A press on that space closes the viewer; a press on the picture does not.
 * Without the size of the picture, nothing can be inside it.
 */
export function insidePicture(box: Box, natural: Size | null, point: { x: number; y: number }): boolean {
  if (!natural || natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) return false;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  const left = box.left + (box.width - width) / 2;
  const top = box.top + (box.height - height) / 2;
  return point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height;
}

const isRtl = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

const ROUND = 'pressable grid size-11 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25';

export type ImageViewerProps = {
  open: boolean;
  onClose: () => void;
  /** The file name: the title of the dialog. */
  name: string;
  /** The big picture. Null while its link loads or when it cannot show. */
  src: string | null;
  /** The small picture. It shows at once, and the big one comes over it when it has loaded. */
  placeholder?: string | null;
  /** The big picture and the small one both failed, so the viewer says so. */
  failed?: boolean;
  onError?: () => void;
  onPlaceholderError?: () => void;
  onDownload: () => void;
  /** Several pictures: the place of this one, and the move to another one. */
  position?: { index: number; count: number; onMove: (index: number) => void };
  /** The control that takes the focus when the viewer closes. The preview that the person pressed, for example. */
  focusAfter?: () => HTMLElement | null;
};

/**
 * A picture over the whole screen, on a dark backdrop (owner, 2026-10-19). It has the file name, an X button, a Download button, and
 * with several pictures a Previous and a Next button (the arrow keys move too, and follow the page direction). Escape, the X and a press
 * on the dark space close it. It is a Vaul dialog like Sheet, so it stacks over a sheet: a press inside it never closes the sheet
 * under it, and Escape closes it first.
 */
export function ImageViewer({ open, onClose, name, src, placeholder = null, failed = false, onError, onPlaceholderError, onDownload, position, focusAfter }: ImageViewerProps) {
  const { t } = useTranslation();
  usePanelOpen(open);
  // The toasts make way for an open viewer, as for a sheet.
  useSheetToasts(open);
  const big = useRef<HTMLImageElement>(null);
  const small = useRef<HTMLImageElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // The big picture fades in over the small one once it has loaded. A new picture starts hidden again.
  const [shown, setShown] = useState<string | null>(null);
  const several = position !== undefined && position.count > 1;
  // The zoom (fbk_038): pinch, double-tap, wheel, click, drag and the keys + - 0. A new picture, and an opened viewer, start at 1x.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const loaded = () => [big.current, small.current].find((img) => img !== null && img.naturalWidth > 0) ?? null;
  const zoom = useImageZoom({ stage, picture: loaded, resetKey: `${open}|${position?.index ?? 0}|${name}` });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (zoom.onKey(event)) return;
    if (!position || event.defaultPrevented) return;
    const rtl = isRtl();
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const back = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (forward && position.index < position.count - 1) {
      event.preventDefault();
      position.onMove(position.index + 1);
    } else if (back && position.index > 0) {
      event.preventDefault();
      position.onMove(position.index - 1);
    }
  };

  // A press on the dark space closes, only at 1x. The picture sits in a box that it only partly fills, so the press point decides. A
  // press on the picture toggles the zoom (a mouse click), and a press that ends a drag is nothing.
  const onStagePress = (event: MouseEvent<HTMLDivElement>) => {
    const picture = loaded();
    const natural = picture ? { width: picture.naturalWidth, height: picture.naturalHeight } : null;
    const inside = picture !== null && insidePicture(picture.getBoundingClientRect(), natural, { x: event.clientX, y: event.clientY });
    zoom.press(event, inside, onClose);
  };

  return (
    <Drawer.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }} direction="bottom" modal handleOnly>
      <Drawer.Portal>
        <Drawer.Content
          ref={content}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            content.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusAfter?.()?.focus();
          }}
          // A press on a toast (a failed download) is not a press outside the viewer.
          onPointerDownOutside={(event) => {
            if (isToastPress(event.detail.originalEvent)) event.preventDefault();
          }}
          className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white outline-none"
        >
          <header className="flex items-center gap-3 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <div className="min-w-0 flex-1">
              <Drawer.Title className="truncate text-subheadline font-semibold"><bdi>{name}</bdi></Drawer.Title>
              {several && <p className="tabular text-footnote text-white/70">{t('picture.position', { index: position.index + 1, count: position.count })}</p>}
            </div>
            <button
              type="button"
              onClick={onDownload}
              aria-label={t('attachments.download', { name })}
              className="pressable inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 text-subheadline font-semibold text-white hover:bg-white/25"
            >
              <AnimatedIcon icon={DownloadIcon} size={18} aria-hidden />
              {t('files.download')}
            </button>
            <button type="button" data-autofocus onClick={onClose} aria-label={t('common.close')} className={ROUND}>
              <AnimatedIcon icon={XIcon} size={18} aria-hidden />
            </button>
          </header>
          {/* touch-none: the stage takes every gesture itself, so the page never scrolls or zooms behind it. data-vaul-no-drag: a swipe on the
              picture never drags the dialog. */}
          <div
            ref={setStage}
            data-viewer-stage
            data-vaul-no-drag
            onClick={onStagePress}
            {...zoom.stageProps}
            className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${zoom.zoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
          >
            <div
              data-zoom-layer
              style={zoom.layerStyle}
              className={`absolute inset-0 ${zoom.animating ? 'transition-transform duration-150 motion-reduce:transition-none' : ''} ${zoom.zoomed ? 'will-change-transform' : ''}`}
            >
            {placeholder && (
              <img ref={small} src={placeholder} alt="" draggable={false} onError={onPlaceholderError} className="pointer-events-none absolute inset-0 size-full object-contain sm:inset-6 sm:size-[calc(100%-3rem)]" />
            )}
            {src && (
              <img
                key={src}
                ref={big}
                src={src}
                alt=""
                draggable={false}
                onError={onError}
                onLoad={() => setShown(src)}
                className={`pointer-events-none absolute inset-0 size-full object-contain transition-opacity duration-200 motion-reduce:transition-none sm:inset-6 sm:size-[calc(100%-3rem)] ${shown === src ? 'opacity-100' : 'opacity-0'}`}
              />
            )}
            </div>
            {failed && !placeholder && (
              <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-subheadline text-white/80">{t('picture.failed')}</p>
            )}
            {several && position.index > 0 && (
              <button type="button" onClick={(event) => { event.stopPropagation(); position.onMove(position.index - 1); }} aria-label={t('picture.previous')} className={`${ROUND} absolute start-3 top-1/2 -translate-y-1/2`}>
                <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
              </button>
            )}
            {several && position.index < position.count - 1 && (
              <button type="button" onClick={(event) => { event.stopPropagation(); position.onMove(position.index + 1); }} aria-label={t('picture.next')} className={`${ROUND} absolute end-3 top-1/2 -translate-y-1/2`}>
                <AnimatedIcon icon={ChevronRightIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
              </button>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
