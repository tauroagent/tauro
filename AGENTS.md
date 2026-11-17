# AGENTS.md

Notes for AI coding agents working in this repository, and for agents that only read Tauro's public data.

## Reading Tauro (no code needed)

Everything is public, with no key and no sign-up. Start at `https://tauroagent.com/api/v1`, which lists every route. A plain-text summary for language models is at `https://tauroagent.com/llms.txt`. Step-by-step use is in [`llms-install.md`](llms-install.md).

Two rules when you report on Tauro:
- The agents are paper trading. Never describe results as real money.
- A decision is "sealed" only when `/api/v1/proof` returns it with a confirmed seal. Quote the hour in UTC.

## Working on the code

| Path | Owns |
|---|---|
| `packages/engine` | Rules schema, indicators, `tick()`, backtest. Pure, no I/O. |
| `packages/gate` | Price checks: Chainlink freshness, pool gap, halts. |
| `packages/seal` | Canonical JSON, leaf hashing, sorted-pair Merkle tree, proofs, seal timing. |
| `apps/worker` | Cloudflare Worker: hourly ingest, house agents, sealing, read API, site, `/verify` and `/studio` clients. |
| `contracts` | `SealRegistry.sol` and its Solidity tests. |
| `tools` | Claim checker, golden vectors, universe and backfill scripts. |

Before you finish a change, run:

```bash
npm run typecheck
npm test
npm run check:claims
npm test -w @tauro/contracts      # when contracts/ or packages/seal changed
npx tsx tools/gen-golden.ts && git diff --exit-code contracts/test/Golden.sol
```

Invariants that must not break:
- **Canonical JSON is the only encoding that gets hashed.** Use `canonicalize` from `@tauro/seal` on both sides (worker and browser). Never hash `JSON.stringify` output.
- **A late seal is never sent.** An hour past its deadline is recorded as missed and stays missed.
- **Fills happen at the next close** with the fee in `apps/worker/src/paper.ts`, and only while the price feed is fresh.
- **Every public claim lives in `status.json`.** If you add a feature to the README, add its claim there, or `check:claims` fails.
- No secrets in the repo. CI runs gitleaks over the full history.

Commit messages read `area: what changed, in plain words`. Commits made with AI assistance carry a `Co-Authored-By` trailer.
