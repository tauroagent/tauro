# Security

Report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository (Security tab). Please do not open a public issue for them.

## Scope

- `contracts/`: SealRegistry. It has no owner, no upgrade path and no pause; the only privileged address is the seal signer fixed at deploy.
- `packages/`: engine, gate and seal logic.

## What we do not have

- No third-party audit. Assurance today comes from the tests in this repository, including fuzz tests on the contract.
- A seal bounty: 5,000,000 TAURO for the first valid way to fake a sealed record or rewrite a sealed hour. Rules and scope: https://tauroagent.com/bounty (open until 31 December 2026).
