import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'vaul';
import { usePanelOpen } from '../app/panelOpen';
import { PRIVATE } from '../app/privateMark';
import { isToastPress, useSheetToasts } from '../app/toasts';
import { AnimatedIcon } from './icons/AnimatedIcon';
import { DownloadIcon } from './icons/animated/download';
import { XIcon } from './icons/animated/x';

export type VideoViewerProps = {
  open: boolean;
  onClose: () => void;
  /** The file name: the title of the dialog. */
  name: string;
  /** The inline link of the video. Null while it loads or when it cannot play. */
  src: string | null;
  /** The link failed twice, or the browser cannot play the video: the player says so and keeps Download. */
  failed?: boolean;
  onError?: () => void;
  onDownload: () => void;
  /** The control that takes the focus when the player closes. The tile that the person pressed, for example. */
  focusAfter?: () => HTMLElement | null;
};

/**
 * A video over the whole screen, on a dark backdrop (owner, 2026-11-03). It has the shell of ImageViewer: the file name, Download and
 * an X button. The video has the controls of the browser (play, seek, sound, full screen) and starts at once, because the person
 * pressed play. Escape and the X close it. A Vaul dialog like Sheet, so it stacks over a sheet. A video that cannot play shows one
 * line, and Download stays.
 */
export function VideoViewer({ open, onClose, name, src, failed = false, onError, onDownload, focusAfter }: VideoViewerProps) {
  const { t } = useTranslation();
  usePanelOpen(open);
  useSheetToasts(open);
  const content = useRef<HTMLDivElement>(null);
  return (
    <Drawer.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }} direction="bottom" modal handleOnly>
      <Drawer.Portal>
        <Drawer.Content
          ref={content}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            content.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusAfter?.()?.focus();
          }}
          onPointerDownOutside={(event) => {
            if (isToastPress(event.detail.originalEvent)) event.preventDefault();
          }}
          className="fixed inset-0 z-50 flex flex-col bg-black/95 pb-[env(safe-area-inset-bottom)] text-white outline-none"
        >
          <header className="flex items-center gap-3 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
            <Drawer.Title className="min-w-0 flex-1 truncate text-subheadline font-semibold"><bdi>{name}</bdi></Drawer.Title>
            <button
              type="button"
              onClick={onDownload}
              aria-label={t('attachments.download', { name })}
              className="pressable inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 text-subheadline font-semibold text-white hover:bg-white/25"
            >
              <AnimatedIcon icon={DownloadIcon} size={18} aria-hidden />
              {t('files.download')}
            </button>
            <button
              type="button"
              data-autofocus
              onClick={onClose}
              aria-label={t('common.close')}
              className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <AnimatedIcon icon={XIcon} size={18} aria-hidden />
            </button>
          </header>
          {/* data-vaul-no-drag: a drag on the seek bar never moves the dialog. */}
          <div data-vaul-no-drag className="relative min-h-0 flex-1 sm:p-6">
            {failed ? (
              <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-subheadline text-white/80">{t('video.failed')}</p>
            ) : (
              src && (
                <video
                  key={src}
                  src={src}
                  controls
                  autoPlay
                  playsInline
                  onError={onError}
                  className={`${PRIVATE} size-full object-contain`}
                />
              )
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
