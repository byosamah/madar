# Madar enterprises (the enterprise core)

The shared server code of Madar enterprises: each enterprise has its own office object, and one platform object holds the list. The
design is `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md`. The shared names are
`docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md` (the section "Lead decisions" wins). The office object is in
`server/office/CLAUDE.md`.

## Files
- `ids.ts`: the id, the address name, the tag and the email rule. It has no import, so the Postgres path may load it.
- `types.ts`: the enterprise records (`EnterpriseRow`, `EnterpriseStatus`, `DayCounts`, limits, state).
- `fanout.ts`: the Cron fan-out (`runFanout`, the transports, `CRON_PATH`).

## Rules
- The enterprise never comes from a header, a query value or a body field that the browser sets. It comes from the signed claim
  `ent`, a tag, the email directory or the MCP address.
- An untrusted id (a tag, an email result, an address) becomes an object stub in `entRouter` only. The router never makes an
  object for a name that the platform object does not list.
- A tagged text has no fallback. An untagged link, key or ticket is refused with the same answer as an unknown one. Never read an
  untagged text as `ENT_VADO`.
- A refusal of a wrong enterprise has the same text as a bad token ("Sign in to continue."). It names no enterprise and no email.
- The Postgres path serves `ENT_VADO` only. No file of this folder that imports `cloudflare:workers` may load there.
- A limit that comes from a Cloudflare plan is a named constant or a setting, never a bare number in a branch.
