# VinuChain Name Service provenance

This directory records the VinuChain testnet VNS deployment and the patched ENS
source tree used to build it.

VNS is based on `@ensdomains/ens-contracts` `1.7.0` and keeps the native
registry, `.vinu` base registrar, commit/reveal registrar controller, public
resolver, reverse registrar, default reverse registrar, name wrapper, bulk
renewal, gateway provider, and universal resolver contracts.

The full patched source snapshot is under `source/contracts/`. Compiled
Hardhat artifacts for every contract in that snapshot are under
`source/artifacts/contracts/`, with ABI-only copies mirrored under
`abis/contracts/`. `artifacts-manifest.json` records the artifact path, ABI
path, and SHA-256 hashes for each compiled output. `build-provenance.json`
also pins the bytecode and deployed-bytecode hashes for the compiled artifact
set used by the deploy scripts. `deployment-testnet.json` remains the source
of truth for active live addresses and parameters, and is updated only after
an authorized on-chain deployment. All 17 deployable contracts (16
ENS-derived plus the VinuChain-specific `VinuUsdOracle`) are pinned together
under `deployedArtifactHashes` in `build-provenance.json`. The
`localExtensions` block retains the `VinuUsdOracle` purpose string so the
VinuChain-specific contract is still discoverable as a local extension and
not mistaken for an upstream ENS contract.

The flat `*.sol` and `*_abi.json` files in this directory are compatibility
copies used by the existing `vinuchain-lists` validator and contract registry
schema for the deployed VNS contracts.

`VinuUsdOracle.sol` is the VinuChain-specific VC/USD conversion oracle for the
active testnet VNS pricing stack. It exposes the `latestAnswer()` interface
expected by `StablePriceOracle`, stores VC/USD with 8 decimals, enforces
configured answer bounds and max-change limits, and reverts when the answer is
stale. The registrar controller does not update this feed; it reads the active
price oracle at quote, registration, and renewal time. That quote is the
enforced VC amount: `ETHRegistrarController.register(...)` rejects underpayment
against the current `rentPrice(...)`, so VNS costs automatically move with the
latest accepted VC/USD answer.

`StablePriceOracle.sol` keeps the USD-denominated rent curve separately from the
live VC conversion. The price-oracle owner can call `setRentPrices(...)` to
change the USD policy for 1-, 2-, 3-, 4-, and 5+ character names. After that
policy change, `ETHRegistrarController.rentPrice(...)` automatically converts
the new USD curve into the enforced VC amount using the current
`VinuUsdOracle` price.

The companion operator script `scripts/update-vns-oracle.js` prices VC from
CoinGecko and guarded VinuSwap V3 TWAP reads. Normal sends require both sources
to be fresh and within the configured deviation threshold; single-source updates
require an explicit emergency flag. The script preflights the target oracle
chain ID, VinuSwap pricing chain ID, oracle identity, signer ownership, answer
bounds, and expected max age before any send.

The active testnet registrar controller now points at `VinuUsdOracle` through a
fresh `ExponentialPremiumPriceOracle`; the legacy `DummyOracle` stack is kept
only as provenance. Public registration should remain disabled on
vinuchain.org until the full stack is reviewed and approved for public launch.

`.github/workflows/vns-oracle-update.yml` runs the VC/USD updater automatically
every four hours at 17 minutes past the hour. The scheduled run performs the
same guarded price resolution and then submits
`VinuUsdOracle.setLatestAnswer(...)` using the `VNS_ORACLE_PRIVATE_KEY`
repository secret. Manual workflow dispatch defaults to dry-run mode, with an
explicit send mode and a separate emergency-only single-source flag if
CoinGecko or the guarded pool fallback is unavailable.

The VNS port patch is recorded in `vns-port.patch`. It changes the ENS `.eth`
constants, DNS wire-name helpers, and price-oracle USD-curve labels in:

* `contracts/ethregistrar/ETHRegistrarController.sol`
* `contracts/ethregistrar/StablePriceOracle.sol`
* `contracts/utils/NameCoder.sol`
* `contracts/wrapper/NameWrapper.sol`

The current testnet deployment intentionally excludes ENS DNSSEC, DNS registrar,
offchain DNS, P-256 verification, L2 reverse registrar, migration flows, and
the upstream `contracts/ethregistrar/BulkRenewal.sol` (which uses the ENS
`ETH_NODE` constant directly). The deployed bulk-renewal helper is the
namehash-agnostic `StaticBulkRenewal.sol`, whose namehash flows through
`ETHRegistrarController.prices` instead of being hardcoded. Those pieces were
not needed for native `.vinu` registration and address resolution on VinuChain
testnet, and the upstream `.eth` references that remain in
`source/contracts/` exist only in non-deployed files (the unported
`BulkRenewal.sol` and the `UpgradedNameWrapperMock.sol` and `TestUnwrap.sol`
test mocks).
