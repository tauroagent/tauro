# Contributing

## Ground rules

- Every public claim lives in `status.json`. A feature is marked live only after it runs in production and can be checked from public data.
- `npm run check:claims` must pass. It compares the README with `status.json` and rejects wording the evidence cannot back.
- Commits read `Area: what changed, in plain words`. Failed experiments get their own commit; they are not deleted.
- No backdated commits, no squashing of main, no generated data committed on a timer. Hourly data lives in the database and on chain, not in git.

## Checks before a pull request

```bash
npm ci
npm run typecheck
npm test
npm run check:claims
npm test -w @tauro/contracts
npx tsx tools/gen-golden.ts && git diff --exit-code contracts/test/Golden.sol
```
