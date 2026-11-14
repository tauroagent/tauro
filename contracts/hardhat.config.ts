import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 10_000 }, evmVersion: "cancun" },
  },
  paths: { sources: "src", tests: { solidity: "test" } },
  test: { solidity: { fuzz: { runs: 10_000 } } },
  networks: {
    robinhood: {
      type: "http",
      chainType: "generic",
      chainId: 4663,
      url: "https://robinhood-rpc.publicnode.com",
      // Stored encrypted with `npx hardhat keystore set ROBINHOOD_DEPLOYER_KEY`; never in a file or env var.
      accounts: [configVariable("ROBINHOOD_DEPLOYER_KEY")],
    },
  },
  chainDescriptors: {
    4663: {
      name: "Robinhood Chain",
      blockExplorers: {
        blockscout: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com", apiUrl: "https://robinhoodchain.blockscout.com/api" },
      },
    },
  },
  verify: { sourcify: { enabled: true }, etherscan: { enabled: false } },
});
