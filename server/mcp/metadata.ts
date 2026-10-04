/**
 * The OAuth parts of the mcp function that an MCP client reads before it has a token (plan 5.6; platform facts 6.7 and 7.5).
 *
 * - GET /mcp/oauth-protected-resource: the Protected Resource Metadata of RFC 9728. resource is MCP_URL; the one authorization
 *   server is Supabase Auth of the project (its issuer). MCP clients find it through the WWW-Authenticate header of a 401.
 * - Every 401 carries WWW-Authenticate: Bearer resource_metadata="<MCP_URL>/oauth-protected-resource", with error="invalid_token"
 *   when a token came and failed (RFC 6750). The description never holds a quote, so the header always parses.
 */

export const METADATA_PATH = '/oauth-protected-resource';

export function resourceMetadataUrl(mcpUrl: string): string {
  return `${mcpUrl.replace(/\/+$/, '')}${METADATA_PATH}`;
}

export type ProtectedResource = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource_name: string;
};

export function protectedResource(o: { mcpUrl: string; issuer: string }): ProtectedResource {
  return { resource: o.mcpUrl, authorization_servers: [o.issuer], bearer_methods_supported: ['header'], resource_name: 'Madar' };
}

export function metadataResponse(o: { mcpUrl: string; issuer: string }): Response {
  return Response.json(protectedResource(o), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  });
}

/** The WWW-Authenticate value of a 401. error is set only when a token came and failed (RFC 6750, section 3.1). */
export function challengeOf(mcpUrl: string, o: { error?: 'invalid_token'; description?: string } = {}): string {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl(mcpUrl)}"`];
  if (o.error) parts.push(`error="${o.error}"`);
  if (o.description) parts.push(`error_description="${o.description.replace(/["\\\r\n]/g, ' ').slice(0, 200)}"`);
  return parts.join(', ');
}
