/**
 * Minimal hardhat config used only for behavioural unit tests of the
 * pre-compiled VinuUsdOracle artifact at
 * contracts/vns/source/artifacts/contracts/ethregistrar/VinuUsdOracle.sol/VinuUsdOracle.json.
 *
 * The full VNS contract build still lives in contracts/vns/source/ under a
 * hardhat-3 + viem + vitest harness. This root config exists ONLY so the
 * mocha+chai+ethers tests in tests/unit/ can spin an in-process EDR network
 * via hardhat v2 + @nomicfoundation/hardhat-network-helpers and exercise the
 * already-compiled bytecode.
 *
 * No `solidity:` block is needed because we never run `hardhat compile` from
 * this config; the tests load the canonical artifact JSON directly. The
 * hardhat-noop-* paths point at directories that do not exist, which is
 * fine for a pure-test-runner config.
 */
require('@nomicfoundation/hardhat-network-helpers');
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');

module.exports = {
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
  },
  paths: {
    sources: './hardhat-noop-sources',
    artifacts: './hardhat-noop-artifacts',
    cache: './hardhat-noop-cache',
    tests: './tests',
  },
  mocha: {
    timeout: 60_000,
  },
};
