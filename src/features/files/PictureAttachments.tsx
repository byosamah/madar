import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '../../api/contract/views';
import { downloadFile, isRemote, useFileLink, usePictureTest } from '../../app/files';
import { useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { useNearView } from '../../app/useNearView';
import { ImageViewer } from '../../components/ImageViewer';
import { FileChips } from './Attachments';

/**
 * The shape of each picture that a screen has shown, by file id. A picture that shows again (a chat that opens again, a message that
 * the log draws again) takes its box at once, so the page does not move a second time. Numbers only: it holds no link and no name.
 */
const SHAPES = new Map<string, number>();
/** The box of a picture before its shape is known. Most photos are 4 to 3. */
const FIRST_SHAPE = 4 / 3;

type Shape = 'single' | 'square' | 'wide';
/** A file that still exists (a deleted file has no name). */
type Named = Attachment & { name: string };

const BOX: Record<Shape, string> = {
  single: 'w-60 max-w-full max-h-80',
  square: 'aspect-square',
  wide: 'aspect-[2/1]',
};

/**
 * One picture of a message as a small preview, with rounded corners. A grey box holds its place while the link and the picture load:
 * a single picture keeps its own shape (the last known one, else 4 to 3), a picture in a grid fills a square tile. A press opens the
 * viewer. A picture that cannot show tells the list (onBroken), which draws it as a chip instead.
 */
function PictureTile({ file, shape, onOpen, onBroken, tiles }: {
  file: Named;
  shape: Shape;
  onOpen: () => void;
  onBroken: (id: string) => void;
  tiles: Map<string, HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const near = useNearView(box);
  const { url, onError, broken } = useFileLink(near ? file.id : null, undefined, 'thumb');
  const [ratio, setRatio] = useState(() => SHAPES.get(file.id) ?? FIRST_SHAPE);
  useEffect(() => {
    if (broken) onBroken(file.id);
  }, [broken, file.id, onBroken]);
  if (broken) return null;
  return (
    <div ref={box} style={shape === 'single' ? { aspectRatio: ratio } : undefined} className={`${BOX[shape]} overflow-hidden rounded-xl`}>
      <button
        ref={(node) => {
          if (node) tiles.set(file.id, node);
          else tiles.delete(file.id);
        }}
        type="button"
        aria-haspopup="dialog"
        aria-label={t('picture.view', { name: file.name })}
        onClick={onOpen}
        className="pressable block size-full bg-fill-strong"
      >
        {url && (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            onError={onError}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth <= 0 || naturalHeight <= 0) return;
              const next = Math.min(3, Math.max(0.4, naturalWidth / naturalHeight));
              SHAPES.set(file.id, next);
              setRatio(next);
            }}
            className="size-full object-cover"
          />
        )}
      </button>
    </div>
  );
}

/**
 * The viewer of the pictures of one message. The big picture asks for its own link only now. The small picture is the preview's link, in
 * the cache, so it shows at once while the big one loads.
 */
function PictureViewer({ pictures, index, open, onMove, onClose, tiles }: {
  pictures: Named[];
  index: number;
  open: boolean;
  onMove: (index: number) => void;
  onClose: () => void;
  tiles: Map<string, HTMLButtonElement>;
}) {
  const runtime = useRuntime();
  const toast = useToast();
  const file = pictures[Math.min(index, pictures.length - 1)];
  const small = useFileLink(file.id, undefined, 'thumb');
  const big = useFileLink(file.id, undefined, 'full');
  return (
    <ImageViewer
      open={open}
      onClose={onClose}
      name={file.name}
      src={big.url}
      placeholder={small.url}
      failed={big.broken && small.broken}
      onError={big.onError}
      onPlaceholderError={small.onError}
      onDownload={() => {
        downloadFile(runtime.api, file.id, undefined, { remote: isRemote(runtime) }).catch((error: unknown) => toast.failed(error));
      }}
      position={pictures.length > 1 ? { index: Math.min(index, pictures.length - 1), count: pictures.length, onMove } : undefined}
      focusAfter={() => tiles.get(file.id) ?? null}
    />
  );
}

/**
 * The files of a chat message or a comment (owner, 2026-10-19). A picture shows as a preview, several pictures as a small grid, and a press
 * opens the viewer with Close and Download. Every other file stays a chip that saves it. A picture that breaks, or that the store
 * keeps as a download (an SVG in the real build), shows as a chip too. The rights to open a file are the same as before: the preview and
 * the viewer ask for the same links as the chip did.
 */
export function AttachmentList({ files }: { files: Attachment[] }) {
  const { t } = useTranslation();
  const isPicture = usePictureTest();
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const [viewer, setViewer] = useState<{ index: number; open: boolean } | null>(null);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const onBroken = useCallback((id: string) => setBroken((all) => (all.has(id) ? all : new Set(all).add(id))), []);
  if (files.length === 0) return null;

  const pictures = files.filter((file): file is Named => file.name !== null && file.mimeType !== undefined && isPicture(file.mimeType) && !broken.has(file.id));
  const chips = files.filter((file) => !pictures.some((picture) => picture.id === file.id));
  const count = pictures.length;
  const columns = count >= 5 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className="flex flex-col gap-1.5">
      {count > 0 && (
        <ul aria-label={t('picture.group')} className={count === 1 ? 'flex min-w-0 max-w-full' : `grid w-60 max-w-full gap-1 ${columns}`}>
          {pictures.map((file, i) => (
            <li key={file.id} className={count === 3 && i === 2 ? 'col-span-2' : count === 1 ? 'flex min-w-0 max-w-full' : undefined}>
              <PictureTile
                file={file}
                shape={count === 1 ? 'single' : count === 3 && i === 2 ? 'wide' : 'square'}
                onOpen={() => setViewer({ index: i, open: true })}
                onBroken={onBroken}
                tiles={tiles.current}
              />
            </li>
          ))}
        </ul>
      )}
      <FileChips files={chips} />
      {viewer && count > 0 && (
        <PictureViewer
          pictures={pictures}
          index={viewer.index}
          open={viewer.open}
          onMove={(index) => setViewer({ index, open: true })}
          onClose={() => setViewer({ index: viewer.index, open: false })}
          tiles={tiles.current}
        />
      )}
    </div>
  );
}

/**
 * True when the words of a message are only the names of its files. A message with files and no words gets the file names as its words
 * (Composer in Thread.tsx), and beside a preview or a chip those names are noise: the bubble then leaves them out (fbk_040). It holds for
 * any file, a picture or not, and only when the words equal the joined names exactly. A person who writes words keeps them. A file that
 * was removed has no name, so the words stay.
 */
export function isFileNamesBody(body: string, files: Attachment[]): boolean {
  if (files.length === 0 || files.some((file) => file.name === null)) return false;
  return body.trim() === files.map((file) => file.name).join(', ');
}
