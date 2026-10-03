/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The build flag (plan, section 3, rule 6): 'fake' (default) or 'remote'. vite.config.ts fixes it at build time. */
  readonly VITE_MADAR_API: 'fake' | 'remote';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_API_URL?: string;
}
