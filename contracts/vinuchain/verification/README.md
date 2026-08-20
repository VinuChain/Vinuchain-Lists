# SFC deployed-bytecode verification artifacts

Everything needed to reproduce and verify the SFC bytecode that is live on chain, and to
verify the contract on a Blockscout explorer.

> **The `out/` directory at the repo root is NOT this.** Those artifacts are compiled with the
> optimizer **disabled** (`runs: 200`), which produces a 76,447-byte SFC that has never been
> deployed anywhere. Deployed SFC bytecode is always compiled with the pinned settings below.

## Canonical compiler settings

Every SFC cycle (158 onward) is compiled identically. Changing any of these produces different
bytecode, which is different chain state:

| Setting | Value |
|---|---|
| solc | `0.5.17+commit.d19bba13` |
| optimizer | **enabled** |
| optimizer runs | **10000** |
| evmVersion | **istanbul** |
| target | `contracts/vinuchain/SFC.sol:SFC` |

```sh
solc --optimize --optimize-runs=10000 --evm-version=istanbul --bin-runtime \
     contracts/vinuchain/SFC.sol
```

## Cycle-165 (current)

Lockup preservation under chunked settlement. Activated on testnet (chain 206) by
`SfcV2Patch10` in node release `v2.0.47-elemont`; installed directly on mainnet (chain 207) at
its first `SfcV2` activation via the node's `GetLatestContractBin()`.

| Property | Value |
|---|---|
| Runtime size | 48,757 bytes |
| Runtime sha256 | `134a508b13d46647052b64f8d6691f0b939d2afaa0fa400882c6653a40a77887` |
| Runtime keccak256 (`codeHash`) | `0x29b88152209fe22bef409376aa7f137d0e0f571f46afa1385f32320765e49e50` |
| Address | `0xFC00FACE00000000000000000000000000000000` |
| Predecessor | Cycle-164, 48,336 bytes, sha256 `b25a749f…4344af`, keccak `0xa7bf8de1…39ac4` |

Storage layout is **identical slot-for-slot** to Cycle-164 and the ABI is unchanged (129
function selectors, zero diff) — see `SFC-cycle165-storage-layout.json` and
`SFC-cycle165-method-identifiers.json`.

| File | Purpose |
|---|---|
| `SFC-cycle165-standard-input.json` | solc standard-JSON input — paste directly into a Blockscout "Standard JSON input" verification |
| `SFC-cycle165-runtime.bin` | deployed runtime bytecode (hex, no `0x`) |
| `SFC-cycle165-creation.bin` | creation bytecode |
| `SFC-cycle165-metadata.json` | solc metadata |
| `SFC-cycle165-storage-layout.json` | storage layout |
| `SFC-cycle165-method-identifiers.json` | function selector map |

## Reproduce and check against the live chain

```sh
# 1. recompile from source and confirm the digest
solc --optimize --optimize-runs=10000 --evm-version=istanbul --bin-runtime \
     -o /tmp/sfcbuild --overwrite contracts/vinuchain/SFC.sol
sha256sum /tmp/sfcbuild/SFC.bin-runtime   # compare to the table above

# 2. confirm it matches what is deployed
curl -s -X POST https://vinufoundation-rpc.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xFC00FACE00000000000000000000000000000000","latest"],"id":1}' \
  | python3 -c 'import sys,json,hashlib;b=bytes.fromhex(json.load(sys.stdin)["result"][2:]);print(len(b),hashlib.sha256(b).hexdigest())'
```

A mismatch between the recompiled digest and the on-chain code means either the source moved
without a recompile, or the chain is running a different cycle than this directory documents.

## Note on the SFC address

The SFC is a **pre-deployed system contract**: its bytecode is written directly into state by
the node at genesis and replaced by the node at `SfcV2`/`SfcV2Patch*` activation seals. There
is no deployment transaction and no constructor call, so the creation bytecode is provided for
completeness only — explorer verification should use the runtime/standard-JSON path.
