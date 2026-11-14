import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys SealRegistry with the seal signer address passed as a parameter:
//   npx hardhat ignition deploy ignition/modules/SealRegistry.ts --network robinhood \
//     --parameters '{"SealRegistry":{"signer":"0x..."}}'
export default buildModule("SealRegistry", (m) => {
  const signer = m.getParameter<string>("signer");
  const registry = m.contract("SealRegistry", [signer]);
  return { registry };
});
