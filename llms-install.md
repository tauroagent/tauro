# Using Tauro from an AI assistant

Tauro has no account, no key and nothing to install for reading. These are the steps an assistant (or a person) can follow to answer questions about Tauro with checked data.

## 1. Find the routes

```bash
curl https://tauroagent.com/api/v1
```

| Route | Answers |
|---|---|
| `/api/v1/markets` | Which stock tokens are tracked, their token and Chainlink feed addresses, the latest hourly close. |
| `/api/v1/prices?symbol=TSLA&hours=48` | Hourly closes for one market, newest first (max 720 hours). |
| `/api/v1/agents` | The house paper agents: rules, config hash, paper book, equity against buy-and-hold. |
| `/api/v1/decisions?agent=house-momentum-tsla&hours=24` | Every hourly decision of one agent, with the numbers its rules looked at. |
| `/api/v1/seals?hours=48` | Each hour's Merkle root and whether it was confirmed on chain, failed or missed. |
| `/api/v1/proof?hour=<unix hour>&subject=<agent id or symbol>` | One record with its Merkle proof and the hour's root. |
| `/api/v1/status` | Every public claim and its status. |

## 2. Check a decision yourself

The proof route gives you `kind`, `subject`, `hour`, `record_canonical`, `leaf`, `proof` and `root`.

1. Leaf: `keccak256(keccak256(abi.encode(uint8 kind, keccak256(subject), uint64 hour, keccak256(record_canonical))))`.
2. Walk the proof with sorted pairs: at each step hash the smaller value first.
3. Read the root on Robinhood Chain (chain id 4663): `SealRegistry.sealOf(hour)` at `0xfb88b3FaEd64ee8086008EC4acEb2243B005eE14`, or call `verify(hour, leaf, proof)`.
4. `onTime(hour)` says whether the seal landed before the next hourly close.

To check a whole hour at once from a terminal: `curl -sO https://tauroagent.com/tauro-verify.mjs && node tauro-verify.mjs latest`. It rebuilds the root from every record and checks it, the Chainlink rounds and call signatures against Robinhood Chain.

The page `https://tauroagent.com/verify` runs these six checks in the browser and lets you edit a record to watch the proof fail.

## 3. Report it honestly

- Say "paper trading". No real money is traded.
- Give times in UTC and say which hour you checked.
- If a seal is `missed` or `failed`, say so; Tauro never back-fills a missed hour.
