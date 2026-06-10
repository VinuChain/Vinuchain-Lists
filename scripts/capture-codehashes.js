#!/usr/bin/env node

/**
 * One-off / re-runnable helper that pins every registry entry's deployed
 * bytecode hashes (addresses AUD-01 hardening).
 *
 * For each token and contract entry it:
 *   1. resolves a chain-ID-verified RPC for the entry's declared chainId;
 *   2. calls eth_getCode(address, latest) and writes keccak256(code) as
 *      `codeHash` — this pins the CONTRACT TYPE (bytecode deployed at the
 *      address). Note: multiple entries can share a codeHash when they use
 *      the same factory/bytecode (e.g. bridged tokens). Per-instance identity
 *      for tokens comes from symbol()/name() checks, not from codeHash alone.
 *   3. for contract entries with an existing or detectable EIP-1967 proxy
 *      shape: reads the implementation slot (0x360894...) via eth_getStorageAt,
 *      fetches the impl's code, and writes keccak256(implCode) as `implCodeHash`.
 *
 * Entries that already carry a pin are only rewritten if the live code's hash
 * differs and --force is passed; by default an existing pin is left as-is and
 * reported, so a re-run never silently overwrites a deliberate pin.
 *
 * Testnet (206) entries whose RPC is unreachable are SKIPPED and reported as
 * left-unpinned rather than failing the run. Use --strict-testnet to make a
 * 206 outage fatal.
 *
 * Usage:
 *   npm run capture:codehashes            # pin all reachable, skip already-pinned
 *   node scripts/capture-codehashes.js --force          # repin even if set
 *   node scripts/capture-codehashes.js --strict-testnet # 206 outage fatal
 */

const fs = require('fs');
const path = require('path');
const { keccak256 } = require('ethers');

const { EXIT_CODES, TESTNET_CHAIN_ID } = require('./utils/constants');
const { safeReadJSON } = require('./utils/safe-json');
const {
  resolveCheckedRpc,
  EIP1967_IMPL_SLOT,
} = require('./validators/onchain-validator');

const DEFAULT_TIMEOUT_MS = Number(process.env.ONCHAIN_RPC_TIMEOUT_MS || 10_000);

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const STRICT_TESTNET =
  args.has('--strict-testnet') || process.env.ONCHAIN_STRICT_TESTNET === '1';

// Minimal JSON-RPC POST with an abort timeout (mirrors the validator helper;
// kept local so this script has no extra surface in the shipped validator).
async function rawJsonRpc(url, method, params, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const payload = JSON.parse(text);
    if (payload.error) {
      throw new Error(
        `${method} JSON-RPC error ${payload.error.code ?? 'unknown'}: ${payload.error.message ?? ''}`.trim()
      );
    }
    return payload.result;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`${method} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function getCode(url, address, fetchImpl, timeoutMs) {
  return rawJsonRpc(url, 'eth_getCode', [address, 'latest'], fetchImpl, timeoutMs);
}

function getStorageAt(url, address, slot, fetchImpl, timeoutMs) {
  return rawJsonRpc(url, 'eth_getStorageAt', [address, slot, 'latest'], fetchImpl, timeoutMs);
}

/**
 * Read the EIP-1967 implementation slot for a potential proxy. Returns the
 * implementation address (lowercase `0x`-prefixed, 42 chars) or null if the
 * slot is zero/unset.
 */
async function readImplAddr(url, address, fetchImpl, timeoutMs) {
  const raw = await getStorageAt(url, address, EIP1967_IMPL_SLOT, fetchImpl, timeoutMs);
  if (!raw || raw === '0x' || raw === ('0x' + '0'.repeat(64))) return null;
  return '0x' + raw.slice(-40).toLowerCase();
}

/**
 * Apply a pin to a field on an object, honouring FORCE. Returns one of:
 *   'pinned'    — newly written
 *   'unchanged' — existing pin matches live value
 *   'conflict'  — existing pin differs and FORCE not set
 */
function applyPin(obj, field, liveHash, label, conflicts, unchanged, pinned) {
  const prior = obj[field];
  if (prior && prior.toLowerCase() === liveHash.toLowerCase()) {
    unchanged.push(`${label} [${field}]`);
    return 'unchanged';
  }
  if (prior && prior.toLowerCase() !== liveHash.toLowerCase() && !FORCE) {
    conflicts.push(
      `${label} [${field}]: live ${liveHash} != existing pin ${prior} (kept; pass --force to overwrite)`
    );
    return 'conflict';
  }
  obj[field] = liveHash;
  pinned.push(`${label} [${field}] -> ${liveHash}`);
  return 'pinned';
}

/**
 * Build the flat list of pinnable targets. Each target carries the data needed
 * to fetch its code, detect proxies, and write pins back to disk.
 */
function collectTargets(tokensDir, contractsDir) {
  const targets = [];

  if (fs.existsSync(tokensDir)) {
    for (const dir of fs.readdirSync(tokensDir)) {
      if (!dir.startsWith('0x')) continue;
      const file = path.join(tokensDir, dir, `${dir}.json`);
      if (!fs.existsSync(file)) continue;
      const json = safeReadJSON(file);
      targets.push({
        kind: 'token',
        label: `${json.symbol} (${json.address})`,
        chainId: json.chainId,
        address: json.address,
        // Always probe the EIP-1967 impl slot for token entries too — a proxy
        // ERC-20 is valid and must have its implementation pinned just like a
        // contract entry. Proxy-ness is determined from the chain, not the JSON.
        probeProxy: true,
        file,
        obj: json,
        serialize: () => JSON.stringify(json, null, 2) + '\n',
      });
    }
  }

  if (fs.existsSync(contractsDir)) {
    for (const projectSlug of fs.readdirSync(contractsDir)) {
      const infoPath = path.join(contractsDir, projectSlug, 'info.json');
      if (!fs.existsSync(infoPath)) continue;
      const info = safeReadJSON(infoPath);
      if (!Array.isArray(info.contracts)) continue;
      for (const contract of info.contracts) {
        targets.push({
          kind: 'contract',
          label: `${projectSlug}/${contract.name} (${contract.address})`,
          chainId: contract.chainId,
          address: contract.address,
          // Always probe the EIP-1967 impl slot for every contract entry —
          // proxy-ness is determined from the chain, not from a name heuristic.
          probeProxy: true,
          file: infoPath,
          obj: contract,
          // whole info.json is rewritten once per file; shared `info` ref
          serialize: () => JSON.stringify(info, null, 2) + '\n',
        });
      }
    }
  }

  return targets;
}

async function main() {
  const tokensDir = path.join(__dirname, '../tokens');
  const contractsDir = path.join(__dirname, '../contracts');
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable (need Node >= 18)');
  }

  const targets = collectTargets(tokensDir, contractsDir);

  console.log('\n🔒 Capturing deployed-bytecode codeHash pins for the registry\n');
  console.log('='.repeat(60));

  // Resolve one RPC per chain; tolerate testnet outage.
  const chainIds = [...new Set(targets.map(t => t.chainId))].sort((a, b) => a - b);
  const rpcByChain = new Map();
  const skippedChains = [];
  for (const chainId of chainIds) {
    try {
      rpcByChain.set(chainId, await resolveCheckedRpc(chainId, fetchImpl, DEFAULT_TIMEOUT_MS));
    } catch (e) {
      const tolerate = chainId === TESTNET_CHAIN_ID && !STRICT_TESTNET;
      if (tolerate) {
        skippedChains.push(chainId);
        console.warn(
          `\n⚠️  SKIPPING chain ${chainId}: RPC unavailable (${e.message}). ` +
          'Testnet outages are tolerated; re-run when the endpoint is back.'
        );
        continue;
      }
      console.error(`\n❌ Chain ${chainId} RPC unreachable and not tolerated: ${e.message}`);
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
  }

  // Files we have mutated and must rewrite (dedupe contract info.json files).
  const dirtyFiles = new Map(); // file -> serialize fn
  const pinned = [];
  const unchanged = [];
  const conflicts = [];
  const unpinned = [];

  for (const target of targets) {
    const rpcUrl = rpcByChain.get(target.chainId);
    if (!rpcUrl) {
      unpinned.push(`${target.label} [chain ${target.chainId} skipped]`);
      continue;
    }

    // --- codeHash: pin the entry's own bytecode type ---
    let code;
    try {
      code = await getCode(rpcUrl, target.address, fetchImpl, DEFAULT_TIMEOUT_MS);
    } catch (e) {
      unpinned.push(`${target.label}: eth_getCode failed: ${e.message}`);
      continue;
    }
    if (!code || code === '0x') {
      unpinned.push(`${target.label}: no code at address on chain ${target.chainId}`);
      continue;
    }
    const codeHashLive = keccak256(code);
    const codeResult = applyPin(
      target.obj, 'codeHash', codeHashLive, target.label, conflicts, unchanged, pinned
    );
    if (codeResult === 'pinned') {
      dirtyFiles.set(target.file, target.serialize);
    }

    // --- implCodeHash: probe the EIP-1967 slot for every contract entry ---
    // Proxy-ness is determined from the chain, not from the JSON, so we always
    // probe. When the slot is nonzero we pin it. When it is zero we do NOT
    // touch the JSON: if a stale implCodeHash pin is present we REPORT it (we
    // never silently rewrite registry data here), and the on-chain validator
    // hard-errors on a declared-pin/zero-slot mismatch anyway.
    if (target.probeProxy) {
      let implAddr;
      try {
        implAddr = await readImplAddr(rpcUrl, target.address, fetchImpl, DEFAULT_TIMEOUT_MS);
      } catch (e) {
        unpinned.push(`${target.label} [implCodeHash]: eth_getStorageAt failed: ${e.message}`);
        continue;
      }
      if (!implAddr) {
        // Not a proxy (slot is zero). If the entry somehow has a stale
        // implCodeHash pin, report it so the operator can investigate.
        if (target.obj.implCodeHash) {
          unpinned.push(
            `${target.label} [implCodeHash]: impl slot is zero but entry has an existing ` +
            `implCodeHash pin ${target.obj.implCodeHash} — stale pin; investigate.`
          );
        }
        // No impl to capture; continue to next entry.
        continue;
      }
      let implCode;
      try {
        implCode = await getCode(rpcUrl, implAddr, fetchImpl, DEFAULT_TIMEOUT_MS);
      } catch (e) {
        unpinned.push(`${target.label} [implCodeHash]: eth_getCode(${implAddr}) failed: ${e.message}`);
        continue;
      }
      if (!implCode || implCode === '0x') {
        unpinned.push(`${target.label} [implCodeHash]: impl at ${implAddr} has no code`);
        continue;
      }
      const implHashLive = keccak256(implCode);
      const implResult = applyPin(
        target.obj, 'implCodeHash', implHashLive, target.label, conflicts, unchanged, pinned
      );
      if (implResult === 'pinned') {
        dirtyFiles.set(target.file, target.serialize);
      }
    }
  }

  for (const [file, serialize] of dirtyFiles) {
    fs.writeFileSync(file, serialize());
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 codeHash capture summary\n');
  console.log(`Total entries: ${targets.length}`);
  console.log(`Newly pinned / updated: ${pinned.length}`);
  console.log(`Already pinned (unchanged): ${unchanged.length}`);
  if (skippedChains.length) {
    console.log(`Skipped chains (RPC unavailable): ${skippedChains.join(', ')}`);
  }
  if (pinned.length) {
    console.log('\nPinned:');
    pinned.forEach(p => console.log(`  ✓ ${p}`));
  }
  if (unpinned.length) {
    console.log('\n⚠️  Left UNPINNED:');
    unpinned.forEach(p => console.log(`  - ${p}`));
  }
  if (conflicts.length) {
    console.log('\n❗ Existing-pin conflicts (NOT overwritten — investigate):');
    conflicts.forEach(p => console.log(`  ! ${p}`));
  }
  console.log('');

  // A conflict on a verified-correct entry is a loud signal: either the code
  // legitimately changed or the address was swapped. Exit non-zero so CI catches it.
  if (conflicts.length) {
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }
  process.exit(EXIT_CODES.SUCCESS);
}

if (require.main === module) {
  main().catch(e => {
    console.error(`\nFATAL ERROR: ${e.message}`);
    if (e.stack) console.error(e.stack);
    process.exit(EXIT_CODES.FATAL_ERROR);
  });
}

module.exports = { collectTargets };
