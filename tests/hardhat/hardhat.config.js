/**
 * Hardhat project used only for behavioural unit tests of the pre-compiled
 * VinuUsdOracle artifact at
 * contracts/vns/source/artifacts/contracts/ethregistrar/VinuUsdOracle.sol/VinuUsdOracle.json.
 *
 * It lives in its own directory, with its own `package.json` declaring
 * `"type": "module"`, because hardhat 3 refuses to run in a CommonJS package.
 * The repository root is CommonJS — 45 files across scripts/, tests/ and the
 * validators use `require()` — and converting the validator and the oracle
 * updater (which runs in CI against the production signing key) to ESM to
 * satisfy one test runner is a far larger blast radius than the test is worth.
 * Scoping the ESM requirement to this directory keeps hardhat current and
 * leaves the rest of the registry untouched.
 *
 * No `solidity:` block and a `sources` path that does not exist: we never
 * compile from here, the tests load the canonical artifact JSON directly.
 * `test:hardhat` passes `--no-compile` so no solc download happens in CI.
 */
import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import hardhatNetworkHelpers from '@nomicfoundation/hardhat-network-helpers';

export default {
  // Hardhat 3 registers plugins through this array; hardhat 2 registered them
  // through `require()` side effects, and mocha is no longer built in.
  plugins: [
    hardhatEthers,
    hardhatNetworkHelpers,
    hardhatEthersChaiMatchers,
    hardhatMocha,
  ],
  networks: {
    hardhat: {
      type: 'edr-simulated',
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
  },
  paths: {
    sources: './noop-sources',
    tests: { mocha: '.' },
  },
  test: {
    mocha: {
      timeout: 60_000,
    },
  },
};
