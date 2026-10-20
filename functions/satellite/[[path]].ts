// Cloudflare Pages Function for /satellite/<z>/<y>/<x>: one satellite tile of the maps, through our own edge (server/http/pagesSatellite.ts).
import { satelliteTile } from '../../server/http/pagesSatellite';

export const onRequest = ({ request, env }: { request: Request; env: Record<string, unknown> }): Promise<Response> => satelliteTile(request, env);
