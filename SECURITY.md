# Security

Report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository (Security tab). Please do not open a public issue for them.

## Scope

- `contracts/`: SealRegistry. It has no owner, no upgrade path and no pause; the only privileged address is the seal signer fixed at deploy.
- `packages/`: engine, gate and seal logic.

## What we do not have

- No third-party audit. Assurance today comes from the tests in this repository, including fuzz tests on the contract.
- No bug bounty yet.
