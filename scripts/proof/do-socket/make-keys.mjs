// Makes the local inputs of probe 3: one bcrypt cost 10 hash of a probe password, one throwaway ES256 key pair,
// and one fixed ES256 token. The private key goes only to keys/ (git never sees it) and to a Worker secret.
import bcrypt from "bcryptjs";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { writeFileSync } from "node:fs";
const hash = bcrypt.hashSync("a probe password", 10);
const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const pub = { ...(await exportJWK(publicKey)), kid: "probe-1", alg: "ES256", use: "sig" };
const priv = { ...(await exportJWK(privateKey)), kid: "probe-1", alg: "ES256" };
const token = await new SignJWT({ role: "authenticated", session_id: "probe" })
  .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "probe-1" })
  .setIssuer("madar-probe").setAudience("authenticated").setSubject("00000000-0000-4000-8000-000000000001")
  .setIssuedAt().setExpirationTime("30d").sign(privateKey);
writeFileSync("keys/private.jwk.json", JSON.stringify(priv), { mode: 0o600 });
writeFileSync("keys/token.txt", token, { mode: 0o600 });
writeFileSync("public-inputs.json", JSON.stringify({ bcryptHash: hash, publicJwk: pub }, null, 1));
console.log("hash prefix", hash.slice(0, 7), "token length", token.length);
