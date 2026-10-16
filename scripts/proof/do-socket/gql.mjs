// Sends one GraphQL query to the Cloudflare Analytics API with the wrangler OAuth token. It never prints the token.
// Use: node gql.mjs <file with the query> [variables JSON]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const toml = readFileSync(homedir() + "/Library/Preferences/.wrangler/config/default.toml", "utf8");
const token = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) { console.log("no oauth_token in the wrangler config"); process.exit(1); }
const query = readFileSync(process.argv[2], "utf8");
const variables = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
console.log(r.status, JSON.stringify(await r.json(), null, 1));
