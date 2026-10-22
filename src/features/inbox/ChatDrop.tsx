import { createContext, useCallback, useContext, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { UploadIcon } from '../../components/icons/animated/upload';

/**
 * Drop files on an open chat or task thread (chat design 2026-10-19, item 14, fbk_030). The area wraps the whole loaded pane (header,
 * log, box and sheets). The message box registers as the receiver while it can take files; a closed chat or a thread where the
 * person may not post has no box, so no receiver: the drop does nothing, but the browser still never opens the file.
 */
type Receive = (files: File[]) => void;
const DropSlot = createContext<((receive: Receive | null) => void) | null>(null);

/** True when the drag carries files. A drag of selected text or of a link carries none and is left alone. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * `className` sets the box of the area. The default fills the pane of a chat. The comments of a task panel (CommentThread) pass "relative",
 * so the area is no flex item there and the panel keeps its layout.
 */
export function ChatDropArea({ note, className = 'relative flex min-h-0 flex-1 flex-col', children }: { note: string; className?: string; children: ReactNode }) {
  const { t } = useTranslation();
  // The receiver is kept in a ref, so a box that makes a new closure on each render does not render the area again.
  const receiver = useRef<Receive | null>(null);
  const [ready, setReady] = useState(false);
  const [over, setOver] = useState(false);
  // A drag that moves over the children sends a leave and an enter for each one, so the frame counts the enters.
  const depth = useRef(0);
  const register = useCallback((receive: Receive | null) => {
    receiver.current = receive;
    setReady(receive !== null);
    if (receive === null) {
      depth.current = 0;
      setOver(false);
    }
  }, []);
  return (
    <DropDraw
      ready={ready}
      over={over}
      onEnter={(event) => {
        if (!carriesFiles(event)) return;
        depth.current += 1;
        if (receiver.current) setOver(true);
      }}
      onOver={(event) => {
        if (!carriesFiles(event)) return;
        // Also with no receiver: the browser must never open the dropped file and leave Madar.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onLeave={(event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        receiver.current?.([...event.dataTransfer.files]);
      }}
      title={t('chat.dropToAttach')}
      note={note}
      className={className}
    >
      <DropSlot.Provider value={register}>{children}</DropSlot.Provider>
    </DropDraw>
  );
}

/** The box and the frame of the area. */
function DropDraw({ ready, over, onEnter, onOver, onLeave, onDrop, title, note, className, children }: {
  ready: boolean; over: boolean; title: string; note: string; className: string; children: ReactNode;
  onEnter: (event: DragEvent) => void; onOver: (event: DragEvent) => void; onLeave: (event: DragEvent) => void; onDrop: (event: DragEvent) => void;
}) {
  return (
    <div className={className} onDragEnter={onEnter} onDragOver={onOver} onDragLeave={onLeave} onDrop={onDrop}>
      {children}
      {ready && over && (
        <div role="status" className="absolute inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-link/60 bg-panel/85 text-center">
          <div className="flex flex-col items-center gap-1.5 px-6">
            <span className="grid size-14 place-items-center rounded-full bg-fill text-link">
              <AnimatedIcon icon={UploadIcon} size={26} aria-hidden />
            </span>
            <p className="text-headline text-ink">{title}</p>
            <p className="text-footnote text-ink-2">{note}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The box takes the files that are dropped on its chat. Pass null while the box cannot take files. One receiver at a time. The function
 * may change on each render: the area calls the newest one.
 */
export function useChatDropReceiver(receive: Receive | null): void {
  const register = useContext(DropSlot);
  const latest = useRef(receive);
  useEffect(() => {
    latest.current = receive;
  });
  const present = receive !== null;
  useEffect(() => {
    if (!register || !present) return undefined;
    register((files) => latest.current?.(files));
    return () => register(null);
  }, [register, present]);
}

/** Gives the files that are dropped on the area to a box. It draws nothing. Pass `onFiles` only where the person may upload. */
export function DropReceiver({ onFiles }: { onFiles: (files: File[]) => void }) {
  useChatDropReceiver(onFiles);
  return null;
}
