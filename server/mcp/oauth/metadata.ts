import { ownIssuer } from '../../auth/ownKeys';

/**
 * The authorization server document of the own OAuth server (RFC 8414; Supabase exit, wave 2). The issuer is MCP_URL, so an MCP
 * client finds the document at /.well-known/oauth-authorization-server/mcp (the Pages Function of wave 5), else at
 * /mcp/.well-known/openid-configuration under the /mcp forwarder of today (MCP draft, authorization server discovery). The same
 * document serves both paths: it has the fields that the SDK checks for an OpenID document. No client ID metadata document: that
 * is a fetch, and the office object does no network work.
 */
export const WELL_KNOWN = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'] as const;

export function authServerMetadata(mcpUrl: string) {
  const issuer = ownIssuer(mcpUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/oauth/jwks`,
    scopes_supported: ['madar'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
  };
}
