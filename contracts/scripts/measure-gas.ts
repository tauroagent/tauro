// Measures SealRegistry gas on the in-process Hardhat network. Numbers go into BENCHMARKS.md.
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();
const [signer] = await viem.getWalletClients();
const pub = await viem.getPublicClient();
const reg = await viem.deployContract("SealRegistry", [signer!.account.address]);
const deployGas = (await pub.getTransactionReceipt({ hash: reg.deploymentTransaction?.hash ?? (await pub.getBlock({ includeTransactions: true })).transactions[0]!.hash })).gasUsed;

const H = 1_794_690_000n;
await networkHelpers.time.increaseTo(Number(H) + 7200);
const zero = `0x${"00".repeat(32)}` as const;
const r1 = `0x${"11".repeat(32)}` as const;
const r2 = `0x${"22".repeat(32)}` as const;
const g1 = (await pub.waitForTransactionReceipt({ hash: await reg.write.seal([H, r1, zero, 36]) })).gasUsed;
const g2 = (await pub.waitForTransactionReceipt({ hash: await reg.write.seal([H + 3600n, r2, r1, 36]) })).gasUsed;
console.log(JSON.stringify({ deployGas: deployGas.toString(), firstSeal: g1.toString(), laterSeal: g2.toString() }));
