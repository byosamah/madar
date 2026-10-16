// Runs one GraphQL query for each crypto window of round 2 and prints the answers in one line each.
import { execFileSync } from "node:child_process";
const [file, ...wins] = process.argv.slice(2);
for (const w of wins) {
  const [name, from, to] = w.split(",");
  const vars = JSON.stringify({ acc: "d76d34779c63849f5acdf3d6af3751cd", from: `2026-10-16T${from}Z`, to: `2026-10-16T${to}Z` });
  const out = execFileSync("node", ["gql.mjs", file, vars], { encoding: "utf8" }).replace(/\s+/g, "");
  console.log(name.padEnd(14), out.slice(0, 700));
}
