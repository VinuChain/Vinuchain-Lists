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
set used by the contracts recorded in `deployment-testnet.json`.

The flat `*.sol` and `*_abi.json` files in this directory are compatibility
copies used by the existing `vinuchain-lists` validator and contract registry
schema for the deployed VNS contracts.

`VinuUsdOracle.sol` is the VinuChain-specific price-feed contract for the
active testnet VNS controller deployment. It exposes the `latestAnswer()` interface
expected by `StablePriceOracle`, stores VC/USD with 8 decimals, restricts price
updates to the owner, enforces configured answer bounds and max-change limits,
and reverts when the answer is stale. The companion operator script
`scripts/update-vns-oracle.js` prices VC from CoinGecko and guarded VinuSwap V3
TWAP reads. Normal sends require both sources to be fresh and within the
configured deviation threshold; single-source updates require an explicit
emergency flag. The script preflights the target oracle chain ID, VinuSwap
pricing chain ID, oracle identity, signer ownership, answer bounds, and expected
max age before any send.

The active testnet registrar controller now points at `VinuUsdOracle` through a
fresh `ExponentialPremiumPriceOracle`; the legacy `DummyOracle` stack is kept
only as provenance. Public registration should remain disabled on
vinuchain.org until the full stack is reviewed and approved for public launch.

The VNS port patch is recorded in `vns-port.patch`. It changes the ENS `.eth`
constants and DNS wire-name helpers in:

* `contracts/ethregistrar/ETHRegistrarController.sol`
* `contracts/wrapper/NameWrapper.sol`
* `contracts/utils/NameCoder.sol`

The current testnet deployment intentionally excludes ENS DNSSEC, DNS registrar,
offchain DNS, P-256 verification, L2 reverse registrar, and migration flows.
Those pieces were not needed for native `.vinu` registration and address
resolution on VinuChain testnet.
