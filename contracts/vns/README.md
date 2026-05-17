# VinuChain Name Service provenance

This directory records the VinuChain testnet VNS deployment and the patched ENS
source tree used to build it.

VNS is based on `@ensdomains/ens-contracts` `1.7.0` and keeps the native
registry, `.vinu` base registrar, commit/reveal registrar controller, public
resolver, reverse registrar, default reverse registrar, name wrapper, bulk
renewal, gateway provider, and universal resolver contracts.

The full patched source snapshot is under `source/contracts/`. The flat
`*.sol` and `*_abi.json` files in this directory are compatibility copies used
by the existing `vinuchain-lists` validator and contract registry schema.

The VNS port patch is recorded in `vns-port.patch`. It changes the ENS `.eth`
constants and DNS wire-name helpers in:

* `contracts/ethregistrar/ETHRegistrarController.sol`
* `contracts/wrapper/NameWrapper.sol`
* `contracts/utils/NameCoder.sol`

The current testnet deployment intentionally excludes ENS DNSSEC, DNS registrar,
offchain DNS, P-256 verification, L2 reverse registrar, and migration flows.
Those pieces were not needed for native `.vinu` registration and address
resolution on VinuChain testnet.

