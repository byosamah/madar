// Cloudflare Pages Function for /.well-known/openid-configuration/*: the OIDC form of the discovery document of the own OAuth
// server of an office copy (server/http/pagesWellKnown.ts). Every other copy answers 404.
import { proxyWellKnown } from '../../../server/http/pagesWellKnown';

export const onRequest = ({ request, env }: { request: Request; env: Record<string, unknown> }): Promise<Response> => proxyWellKnown(request, fetch, env);
