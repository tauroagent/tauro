// Fails when public text drifts from status.json or uses words the evidence cannot back.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const status = JSON.parse(readFileSync(join(root, "status.json"), "utf8"));
const LABEL = { live: "Live", in_testing: "In testing", planned: "Planned" };
const problems = [];

// 1. README status table must match status.json row for row.
const readme = readFileSync(join(root, "README.md"), "utf8");
const block = readme.match(/<!-- status:start -->([\s\S]*?)<!-- status:end -->/);
if (!block) problems.push("README.md: status block missing");
else {
  const want = ["| Claim | Status |", "|---|---|", ...status.claims.map((c) => {
    if (!LABEL[c.status]) problems.push(`status.json: unknown status "${c.status}" for ${c.id}`);
    if (c.status === "live" && !c.proof) problems.push(`status.json: live claim ${c.id} has no proof`);
    return `| ${c.text} | ${LABEL[c.status]} |`;
  })].join("\n");
  if (block[1].trim() !== want) problems.push("README.md: status table differs from status.json (regenerate it)");
}

// 2. Banned words in public text.
const BANNED = [
  "ai-powered", "ai trader", "autonomous ai", "self-learning", "sentient", "agi",
  "trustless", "decentralized", "fully on-chain", "on-chain ai", "on-chain agents", "verifiable ai",
  "tamper-proof", "immutable record", "can't be edited", "unhackable", "bank-grade", "institutional-grade",
  "audited", "alpha", "profitable", "beats the market", "guaranteed", "apy", "passive income",
  "holders earn", "buyback", "revenue share", "dividend", "real-time", "24/7",
  "first-ever", "revolutionary", "game-changing", "next-gen", "the future of",
  "coming soon", "waitlist", "partnered with", "powered by robinhood", "powered by chainlink",
];
const files = ["README.md", "CONTRIBUTING.md", "SECURITY.md"];
if (existsSync(join(root, "docs"))) for (const f of readdirSync(join(root, "docs"))) if (f.endsWith(".md")) files.push(`docs/${f}`);
for (const f of files) {
  if (!existsSync(join(root, f))) continue;
  const text = readFileSync(join(root, f), "utf8").toLowerCase();
  for (const w of BANNED) {
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(text)) problems.push(`${f}: banned phrase "${w}"`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`claimcheck: ${status.claims.length} claims, ${files.length} files, 0 problems`);
