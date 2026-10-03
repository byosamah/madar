// The api function: a thin wrapper over the bundle that `npm run build:server` writes (vite.server.config.ts). Edit server/, never this bundle.
import entry from '../_build/api.js';

Deno.serve((request) => entry.fetch(request));
