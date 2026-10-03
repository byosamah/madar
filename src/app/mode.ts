/**
 * Which API the screens use (client map 8). The value is fixed at build time, so the prototype build drops the remote code
 * and the remote build drops the prototype controls: write {PROTOTYPE && <PreviewAs />}.
 */
export const REMOTE = import.meta.env.VITE_MADAR_API === 'remote';
export const PROTOTYPE = !REMOTE;
