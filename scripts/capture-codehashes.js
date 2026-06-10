#!/usr/bin/env node

/**
 * One-off / re-runnable helper that pins every registry entry's deployed
 * bytecode identity (addresses AUD-01 hardening).
 *
 * For each token and contract entry it:
 *   1. resolves a chain-ID-verified RPC for the entry's declared chainId
 *      (reusing the on-chain validator's health-probe so a mis-set RPC fails
 *      fast instead of writing a bogus hash);
 *   2. calls eth_getCode(address, latest);
 *   3. writes keccak256(code) back into that entry's JSON as `codeHash`.
 *
 * Entries that already carry a codeHash are only rewritten if the live code's
 * hash differs and --force is passed; by default an existing pin is left as-is
 * and reported, so a re-run never silently overwrites a deliberate pin.
 *
 * Testnet (206) entries whose RPC is unreachable (the public testnet endpoint
 * reboots) are SKIPPED and reported as left-unpinned rather than failing the
 * run. Use --strict-testnet to make a 206 outage fatal.
 *
 * Usage:
 *   npm run capture:codehashes            # pin all reachable, skip pinned
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
} = require('./validators/onchain-validator');

const DEFAULT_TIMEOUT_MS = Number(process.env.ONCHAIN_RPC_TIMEOUT_MS || 10_000);

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const STRICT_TESTNET =
  args.has('--strict-testnet') || process.env.ONCHAIN_STRICT_TESTNET === '1';

function getCode(url, address, fetchImpl, timeoutMs) {
  return rawJsonRpc(url, 'eth_getCode', [address, 'latest'], fetchImpl, timeoutMs);
}

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

/**
 * Build the flat list of pinnable targets. Each target carries the data needed
 * to fetch its code and to write the codeHash back to disk.
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
        file,
        // token JSON is the whole file object
        apply: (hash) => { json.codeHash = hash; },
        existing: () => json.codeHash,
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
          file: infoPath,
          // mutate the shared `info` object; whole file rewritten once per file
          apply: (hash) => { contract.codeHash = hash; },
          existing: () => contract.codeHash,
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
  const dirtyFiles = new Map(); // file -> serialize()
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
    const hash = keccak256(code);
    const prior = target.existing();
    if (prior && prior.toLowerCase() === hash.toLowerCase()) {
      unchanged.push(target.label);
      continue;
    }
    if (prior && prior.toLowerCase() !== hash.toLowerCase() && !FORCE) {
      conflicts.push(
        `${target.label}: live ${hash} != existing pin ${prior} (kept; pass --force to overwrite)`
      );
      continue;
    }
    target.apply(hash);
    dirtyFiles.set(target.file, target.serialize);
    pinned.push(`${target.label} -> ${hash}`);
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
    console.log('\n❗ Existing-pin conflicts (NOT overwritten — investigate, these may be substituted contracts):');
    conflicts.forEach(p => console.log(`  ! ${p}`));
  }
  console.log('');

  // A conflict on an entry that is supposed to be verified-correct is a loud
  // signal: either the code legitimately changed or the address was swapped.
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
