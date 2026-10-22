/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build flag (plan, section 3, rule 6): 'fake' (default) or 'remote'. vite.config.ts fixes it at build time. */
  readonly VITE_MADAR_API: 'fake' | 'remote';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The public VAPID key of browser push (config/remote.<env>.env). Missing: the Settings row says push is not set up. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** 'on' shows the Satellite button of the maps (config/remote.<env>.env). The Esri key itself is a Pages secret (ESRI_KEY). */
  readonly VITE_MADAR_SATELLITE?: string;
  readonly VITE_API_URL?: string;
  /** The build ID (scripts/build-remote.ts): the UTC day of the build, sent as X-Madar-Build. */
  readonly VITE_MADAR_BUILD?: string;
  /** The page hosts that serve /api, comma separated (build-remote.ts). WebKit browsers send their calls there (api/remote/pageApi.ts). */
  readonly VITE_API_PAGE_HOSTS?: string;
  /**
   * The live updates (exit wave 3): 'socket' for the office object, else Supabase Realtime. No build sets it yet. A build with
   * VITE_MADAR_AUTH=madar opens the socket in any case (liveKindOf, src/app/remote/bootstrap.ts).
   */
  readonly VITE_MADAR_LIVE?: 'socket' | 'realtime';
  /** The sign-in of the remote build (src/app/remote/authMode.ts): supabase (unset) or madar. */
  readonly VITE_MADAR_AUTH?: string;
}
