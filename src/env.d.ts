/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build flag (plan, section 3, rule 6): 'fake' (default) or 'remote'. vite.config.ts fixes it at build time. */
  readonly VITE_MADAR_API: 'fake' | 'remote';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_API_URL?: string;
  /** The same-host batch forwarder (/api/batch), when set. The sign-in requests always use VITE_API_URL. */
  readonly VITE_BATCH_URL?: string;
  /** The build ID (scripts/build-remote.ts): the UTC day of the build, sent as X-Madar-Build. */
  readonly VITE_MADAR_BUILD?: string;
}
