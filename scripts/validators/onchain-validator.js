#!/usr/bin/env node

/**
 * On-chain cross-check validator (addresses AUD-01 technical half).
 *
 * Schema + checksum validation proves an entry is well-formed and that the
 * address is a real, correctly-checksummed address — but NOT that the address
 * actually hosts the contract it claims to. A deliberately-substituted but
 * correctly-checksummed address of an attacker's own contract passes every
 * off-chain check. This module closes that gap by asserting, against the live
 * chain the entry declares:
 *
 *   - the address has code (`eth_getCode !== '0x'`);
 *   - for ERC-20 tokens, `decimals()` matches the JSON decimals (hard);
 *   - for ERC-20 tokens, `symbol()` matches the JSON symbol (hard when the
 *     on-chain symbol decodes cleanly; see below for the fail-closed rule).
 *
 * Bytecode-type pinning with `codeHash`: an entry MAY carry a `codeHash` =
 * keccak256 of the deployed runtime bytecode (eth_getCode result). When
 * present, the validator fetches the live code, hashes it, and HARD-ERRORS on
 * any mismatch — this detects a substituted address whose bytecode differs from
 * the expected contract type.
 *
 * IMPORTANT SCOPE OF `codeHash`: keccak256(runtime bytecode) pins the
 * contract's *type* (i.e. "this is the right bytecode"), not a unique
 * *instance*. Multiple distinct token contracts can share the same runtime
 * bytecode (e.g. BTC@VinuChain, USDT@VinuChain, ETH@VinuChain are all
 * deployed from the same bridged-token factory and share one codeHash).
 * A codeHash match therefore proves "the expected contract bytecode is
 * deployed here" but cannot by itself distinguish which of several
 * identically-bytecoded instances is present.
 *
 * Because of this, ERC-20 tokens ALWAYS require a cleanly-decoded symbol()
 * match (or name() match as fallback) to establish per-instance identity —
 * codeHash alone is not sufficient for tokens. Specifically: if symbol() does
 * not cleanly decode to the expected symbol AND name() does not cleanly decode
 * to the expected name, that is a HARD ERROR even when a codeHash matches.
 * decimals() remains a hard check throughout.
 *
 * For proxy contracts: when a contract entry carries an `implCodeHash`, the
 * validator reads the EIP-1967 implementation slot (0x360894...) via
 * eth_getStorageAt and verifies that the implementation address's bytecode
 * keccak256 matches the pinned value. This adds per-instance depth for
 * contracts that have no symbol/name but delegate to a unique implementation.
 *
 * It reuses the chain-ID-guard + RPC-health-probe pattern from
 * scripts/update-vns-oracle.js: an endpoint is only trusted after its
 * eth_chainId matches the expected chainId, so a mis-set RPC env var pointing
 * at an unrelated chain fails fast instead of producing bogus "no code" errors.
 *
 * Testnet (206) RPC outages are tolerated: 206 checks are SKIPPED with a loud
 * warning rather than failing the run, because the public testnet RPC reboots.
 * Mainnet (207) checks are always strict.
 */

const path = require('path');
const { keccak256 } = require('ethers');

const {
  VALID_CHAIN_IDS,
  TESTNET_CHAIN_ID,
  RPC_URLS_BY_CHAIN_ID,
} = require('../utils/constants');

// ERC-20 read selectors (computed once; avoids pulling a full ABI/ethers
// Interface just for the constant 4-byte selectors).
const SELECTOR_DECIMALS = '0x313ce567'; // decimals()
const SELECTOR_SYMBOL = '0x95d89b41';   // symbol()
const SELECTOR_NAME = '0x06fdde03';     // name()

// EIP-1967 transparent/UUPS proxy implementation slot. When an entry carries
// an `implCodeHash`, this slot is read via eth_getStorageAt to locate the
// implementation address, then that address's bytecode is hashed and compared.
const EIP1967_IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

const DEFAULT_TIMEOUT_MS = Number(process.env.ONCHAIN_RPC_TIMEOUT_MS || 10_000);

function rpcUrlsForChain(chainId) {
  const envByChain = {
    207: process.env.VINUCHAIN_MAINNET_RPC_URL,
    206: process.env.VINUCHAIN_TESTNET_RPC_URL,
  };
  const configured = envByChain[chainId];
  if (configured) {
    return String(configured)
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  const fallback = RPC_URLS_BY_CHAIN_ID[chainId];
  return fallback ? [fallback] : [];
}

/**
 * Minimal JSON-RPC POST with an abort timeout. Returns the `result` field or
 * throws. Injectable `fetchImpl` keeps the module unit-testable without a
 * network.
 */
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
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error(`invalid JSON-RPC response for ${method}: ${e.message}`);
    }
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

function parseHexInt(value) {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    throw new Error(`expected hex quantity, got ${JSON.stringify(value)}`);
  }
  return parseInt(value, 16);
}

/**
 * Decode an ABI-encoded `string` (or bytes32) return value into a JS string.
 * Tolerates non-standard tokens that return a fixed bytes32 symbol.
 */
function decodeAbiString(hex) {
  if (!hex || hex === '0x') return null;
  const data = hex.slice(2);
  // Dynamic string: [offset(32)][length(32)][utf8 bytes...]
  if (data.length >= 128) {
    const len = parseInt(data.slice(64, 128), 16);
    if (Number.isFinite(len) && len > 0 && len <= (data.length - 128) / 2) {
      const strHex = data.slice(128, 128 + len * 2);
      return Buffer.from(strHex, 'hex').toString('utf8');
    }
  }
  // Fallback: treat as bytes32, strip trailing NULs.
  return Buffer.from(data, 'hex').toString('utf8').replace(/\u0000+$/g, '').trim() || null;
}

/**
 * Redact an RPC URL for log/error output: keep scheme + host(+port), drop
 * userinfo, path, and query — provider URLs routinely embed API keys in the
 * path (.../v3/<key>) or as query/userinfo, and validator errors end up in CI
 * logs.
 */
function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '<invalid-url>';
  }
}

/**
 * Probe an RPC endpoint: confirm its eth_chainId matches and it answers
 * eth_blockNumber. Returns the verified url on success; throws otherwise.
 */
async function probeEndpoint(url, expectedChainId, fetchImpl, timeoutMs) {
  if (!VALID_CHAIN_IDS.includes(expectedChainId)) {
    throw new Error(
      `expected chainId ${expectedChainId} is not a known VinuChain network ` +
      `(allowed: ${VALID_CHAIN_IDS.join(', ')})`
    );
  }
  const chainId = parseHexInt(await rawJsonRpc(url, 'eth_chainId', [], fetchImpl, timeoutMs));
  if (chainId !== expectedChainId) {
    throw new Error(`RPC ${redactUrl(url)} is chain ${chainId}; expected ${expectedChainId}`);
  }
  await rawJsonRpc(url, 'eth_blockNumber', [], fetchImpl, timeoutMs);
  return url;
}

/**
 * Resolve a healthy, chain-ID-verified RPC URL for a chain, walking the
 * configured fallback list. Throws with all failure reasons if none pass.
 */
async function resolveCheckedRpc(chainId, fetchImpl, timeoutMs) {
  const urls = rpcUrlsForChain(chainId);
  if (!urls.length) {
    throw new Error(`no RPC URL configured for chain ${chainId}`);
  }
  const failures = [];
  for (const url of urls) {
    try {
      return await probeEndpoint(url, chainId, fetchImpl, timeoutMs);
    } catch (e) {
      failures.push(`${redactUrl(url)}: ${e.message}`);
    }
  }
  throw new Error(`all RPC endpoints for chain ${chainId} failed health checks: ${failures.join('; ')}`);
}

async function getCode(url, address, fetchImpl, timeoutMs) {
  return rawJsonRpc(url, 'eth_getCode', [address, 'latest'], fetchImpl, timeoutMs);
}

async function ethCall(url, to, data, fetchImpl, timeoutMs) {
  return rawJsonRpc(url, 'eth_call', [{ to, data }, 'latest'], fetchImpl, timeoutMs);
}

async function getStorageAt(url, address, slot, fetchImpl, timeoutMs) {
  return rawJsonRpc(url, 'eth_getStorageAt', [address, slot, 'latest'], fetchImpl, timeoutMs);
}

/**
 * Given a contract address that may be an EIP-1967 transparent/UUPS proxy,
 * read the implementation slot and return the implementation address (lowercase
 * `0x`-prefixed, 42 chars), or null if the slot is zero / unset.
 */
async function readEip1967Impl(url, address, fetchImpl, timeoutMs) {
  const raw = await getStorageAt(url, address, EIP1967_IMPL_SLOT, fetchImpl, timeoutMs);
  // Storage value is a 32-byte hex; the address occupies the low 20 bytes.
  if (!raw || raw === '0x' || raw === ('0x' + '0'.repeat(64))) return null;
  return '0x' + raw.slice(-40).toLowerCase();
}

/**
 * Check a single token against its chain. Returns { errors: [], warnings: [] }.
 *
 * Per-instance identity rule (fail-closed):
 *   Because multiple token contracts can share the same runtime bytecode (e.g.
 *   bridged tokens deployed from the same factory), codeHash alone cannot
 *   distinguish instances. Per-instance identity for ERC-20 tokens therefore
 *   requires at least one cleanly-decoded matching on-chain string: symbol()
 *   is tried first; if it reverts, name() is tried as a fallback. Both
 *   mismatching is a HARD ERROR. Both reverting is also a HARD ERROR — there
 *   is no instance-level signal and decimals+code alone are forgeable.
 *
 *   codeHash (when present) verifies bytecode type and hard-errors on a type
 *   mismatch, but does NOT count as the per-instance identity signal for tokens.
 */
async function checkToken(url, token, fetchImpl, timeoutMs) {
  const errors = [];
  const warnings = [];
  const label = `${token.symbol} (${token.address})`;

  const code = await getCode(url, token.address, fetchImpl, timeoutMs);
  if (!code || code === '0x') {
    errors.push(`${label}: no contract code at address on chain ${token.chainId}`);
    return { errors, warnings };
  }

  // codeHash bytecode-type pin — verifies that the expected contract bytecode
  // is deployed here (pins type, not instance). A mismatch means the address
  // hosts a different contract type and is always a hard error. A match does
  // NOT by itself prove per-instance identity for tokens — instance identity
  // comes from symbol()/name() below.
  if (token.codeHash) {
    const onChainHash = keccak256(code);
    if (onChainHash.toLowerCase() !== String(token.codeHash).toLowerCase()) {
      errors.push(
        `${label}: on-chain code keccak256 ${onChainHash} != pinned codeHash ${token.codeHash} ` +
        `(wrong contract type or stale pin)`
      );
    }
  } else {
    warnings.push(
      `${label}: no codeHash pin — bytecode type is not pinned. ` +
      `Capture one with \`npm run capture:codehashes\` to detect contract-type substitution.`
    );
  }

  // decimals() — hard check always
  try {
    const decRaw = await ethCall(url, token.address, SELECTOR_DECIMALS, fetchImpl, timeoutMs);
    const onChainDecimals = parseHexInt(decRaw);
    if (onChainDecimals !== token.decimals) {
      errors.push(
        `${label}: on-chain decimals ${onChainDecimals} != declared ${token.decimals}`
      );
    }
  } catch (e) {
    errors.push(`${label}: decimals() call failed: ${e.message}`);
  }

  // Per-instance identity: symbol() then name() as fallback.
  // A cleanly-decoded value that MISMATCHES is always a hard error.
  // If symbol() does not decode cleanly, name() is attempted.
  // If neither decodes cleanly, that is a hard error — codeHash alone cannot
  // distinguish instances of identical-bytecode tokens.
  let instanceVerified = false;

  let symbolDecoded = false;
  try {
    const symRaw = await ethCall(url, token.address, SELECTOR_SYMBOL, fetchImpl, timeoutMs);
    const onChainSymbol = decodeAbiString(symRaw);
    if (onChainSymbol) {
      symbolDecoded = true;
      if (onChainSymbol.toUpperCase() !== token.symbol.toUpperCase()) {
        errors.push(
          `${label}: on-chain symbol "${onChainSymbol}" != declared "${token.symbol}"`
        );
        // Mismatched symbol — don't fall through to name(); the symbol disagrees.
        return { errors, warnings };
      }
      instanceVerified = true;
    }
  } catch (e) {
    warnings.push(`${label}: symbol() call failed (trying name() fallback): ${e.message}`);
  }

  // nameDecoded: true if name() returned any decodable string (match or not).
  let nameDecoded = false;
  if (!symbolDecoded) {
    // symbol() returned nothing decodable — try name() as a fallback instance signal.
    try {
      const nameRaw = await ethCall(url, token.address, SELECTOR_NAME, fetchImpl, timeoutMs);
      const onChainName = decodeAbiString(nameRaw);
      if (onChainName) {
        nameDecoded = true;
        if (onChainName !== token.name) {
          errors.push(
            `${label}: on-chain name "${onChainName}" != declared "${token.name}" ` +
            `(and symbol() did not decode — no instance identity)`
          );
        } else {
          instanceVerified = true;
        }
      }
    } catch (e) {
      warnings.push(`${label}: name() call also failed: ${e.message}`);
    }
  }

  // Fail-closed only when NEITHER string decoded to anything at all (both
  // reverted or returned empty). A decoded-but-mismatching string already
  // pushed a hard error above; adding a second error here would be redundant.
  if (!instanceVerified && !symbolDecoded && !nameDecoded) {
    errors.push(
      `${label}: no per-instance identity — neither symbol() nor name() decoded to any ` +
      `value. decimals+codeHash alone cannot distinguish instances of ` +
      `identical-bytecode tokens. Fix the registry entry or investigate the address.`
    );
  }

  return { errors, warnings };
}

/**
 * Check a single contract entry: code must exist on its declared chain.
 *
 * codeHash (when present): verifies bytecode type — keccak256(runtime bytecode)
 * pins "the expected contract type is deployed here." A mismatch is a hard
 * error; absent → warning that bytecode type is not pinned. Note: for
 * non-token contracts there is no symbol/name cross-check, so codeHash is the
 * primary type check, but it pins type, not a unique instance.
 *
 * EIP-1967 proxy detection (always): the implementation slot (0x360894...) is
 * probed unconditionally via eth_getStorageAt. If it is nonzero the address IS
 * a proxy on-chain:
 *   - implCodeHash present → fetch impl code, keccak256 it, hard-error on
 *     mismatch (implementation was upgraded or replaced).
 *   - implCodeHash absent  → HARD ERROR: proxy detected but implementation not
 *     pinned. A proxy's codeHash only covers the shell; an unverified
 *     implementation can be swapped without touching the shell hash. This cannot
 *     be bypassed by omitting implCodeHash from the JSON — the chain itself
 *     reports the non-zero slot.
 * If the slot is zero (not a proxy) → implCodeHash is not expected; no check.
 *
 * Returns { errors: string[], warnings: string[] }.
 */
async function checkContractCode(url, contract, projectSlug, fetchImpl, timeoutMs) {
  const errors = [];
  const warnings = [];
  const label = `${projectSlug}/${contract.name} (${contract.address})`;
  const code = await getCode(url, contract.address, fetchImpl, timeoutMs);
  if (!code || code === '0x') {
    errors.push(`${label}: no contract code at address on chain ${contract.chainId}`);
    return { errors, warnings };
  }

  // Bytecode-type pin (proxy shell or non-proxy contract).
  if (contract.codeHash) {
    const onChainHash = keccak256(code);
    if (onChainHash.toLowerCase() !== String(contract.codeHash).toLowerCase()) {
      errors.push(
        `${label}: on-chain code keccak256 ${onChainHash} != pinned codeHash ${contract.codeHash} ` +
        `(wrong contract type or stale pin)`
      );
    }
  } else {
    warnings.push(
      `${label}: no codeHash pin — bytecode type is not pinned. ` +
      `Capture one with \`npm run capture:codehashes\` to detect contract-type substitution.`
    );
  }

  // EIP-1967 proxy detection: always probe the implementation slot so the
  // on-chain proxy shape — not the JSON — determines whether implCodeHash is
  // required. An entry without implCodeHash cannot bypass this by simply
  // omitting the field; the slot value comes from the chain itself.
  try {
    const implAddr = await readEip1967Impl(url, contract.address, fetchImpl, timeoutMs);
    if (implAddr) {
      // Address IS a proxy on-chain.
      if (!contract.implCodeHash) {
        errors.push(
          `${label}: proxy detected on-chain (EIP-1967 implementation slot → ${implAddr}) ` +
          `but implCodeHash is not pinned. The proxy shell codeHash cannot cover the ` +
          `implementation — run \`npm run capture:codehashes\` to pin it.`
        );
      } else {
        // implCodeHash present — verify the implementation.
        const implCode = await getCode(url, implAddr, fetchImpl, timeoutMs);
        if (!implCode || implCode === '0x') {
          errors.push(
            `${label}: implementation at ${implAddr} has no code`
          );
        } else {
          const implHash = keccak256(implCode);
          if (implHash.toLowerCase() !== String(contract.implCodeHash).toLowerCase()) {
            errors.push(
              `${label}: implementation ${implAddr} code keccak256 ${implHash} ` +
              `!= pinned implCodeHash ${contract.implCodeHash} ` +
              `(implementation was upgraded or replaced)`
            );
          }
        }
      }
    }
    // implAddr === null → not a proxy; no implCodeHash needed.
  } catch (e) {
    errors.push(`${label}: EIP-1967 proxy slot check failed: ${e.message}`);
  }

  return { errors, warnings };
}

/**
 * Run on-chain cross-checks over the provided tokens and contract entries.
 *
 * @param {Object} options
 * @param {Array} options.tokens - token JSON objects (must carry chainId)
 * @param {Array} options.contracts - { projectSlug, contract } pairs
 * @param {Function} [options.fetchImpl] - injectable fetch (defaults to global)
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.strictTestnet] - if true, 206 RPC outage is fatal
 * @param {Function} [options.log] - logger-like { error, warn, info, success }
 * @returns {{ errors: number, warnings: number, skippedChains: number[] }}
 */
async function runOnchainChecks(options) {
  const {
    tokens = [],
    contracts = [],
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    strictTestnet = process.env.ONCHAIN_STRICT_TESTNET === '1',
    log = console,
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable; pass options.fetchImpl');
  }

  let errors = 0;
  let warnings = 0;
  const skippedChains = [];

  // Group all entries by chainId so we resolve each RPC once.
  const byChain = new Map();
  for (const t of tokens) {
    if (!byChain.has(t.chainId)) byChain.set(t.chainId, { tokens: [], contracts: [] });
    byChain.get(t.chainId).tokens.push(t);
  }
  for (const c of contracts) {
    const cid = c.contract.chainId;
    if (!byChain.has(cid)) byChain.set(cid, { tokens: [], contracts: [] });
    byChain.get(cid).contracts.push(c);
  }

  for (const chainId of [...byChain.keys()].sort((a, b) => a - b)) {
    const group = byChain.get(chainId);
    const count = group.tokens.length + group.contracts.length;
    (log.info || log.log)(`\nOn-chain checks for chain ${chainId} (${count} entr${count === 1 ? 'y' : 'ies'})`);

    let rpcUrl;
    try {
      rpcUrl = await resolveCheckedRpc(chainId, fetchImpl, timeoutMs);
    } catch (e) {
      const tolerate = chainId === TESTNET_CHAIN_ID && !strictTestnet;
      if (tolerate) {
        skippedChains.push(chainId);
        warnings++;
        (log.warn || log.log)(
          `\n⚠️  SKIPPING on-chain checks for testnet chain ${chainId}: RPC unavailable (${e.message}). ` +
          'Testnet RPC outages are tolerated; re-run when the endpoint is back, or set ' +
          'ONCHAIN_STRICT_TESTNET=1 to make this fatal.'
        );
        continue;
      }
      (log.error || log.log)(`\n❌ Chain ${chainId} RPC unreachable and not tolerated: ${e.message}`);
      errors++;
      continue;
    }

    for (const token of group.tokens) {
      try {
        const result = await checkToken(rpcUrl, token, fetchImpl, timeoutMs);
        result.errors.forEach(msg => { errors++; (log.error || log.log)(`  ❌ ${msg}`); });
        result.warnings.forEach(msg => { warnings++; (log.warn || log.log)(`  ⚠️  ${msg}`); });
        if (!result.errors.length) {
          (log.success || log.info || log.log)(`  ✓ ${token.symbol} (${token.address})`);
        }
      } catch (e) {
        errors++;
        (log.error || log.log)(`  ❌ ${token.symbol} (${token.address}): on-chain check failed: ${e.message}`);
      }
    }

    for (const { projectSlug, contract } of group.contracts) {
      try {
        const result = await checkContractCode(rpcUrl, contract, projectSlug, fetchImpl, timeoutMs);
        result.errors.forEach(msg => { errors++; (log.error || log.log)(`  ❌ ${msg}`); });
        result.warnings.forEach(msg => { warnings++; (log.warn || log.log)(`  ⚠️  ${msg}`); });
        if (!result.errors.length) {
          (log.success || log.info || log.log)(`  ✓ ${projectSlug}/${contract.name} (${contract.address})`);
        }
      } catch (e) {
        errors++;
        (log.error || log.log)(`  ❌ ${projectSlug}/${contract.name} (${contract.address}): on-chain check failed: ${e.message}`);
      }
    }
  }

  return { errors, warnings, skippedChains };
}

module.exports = {
  runOnchainChecks,
  // exported for unit testing
  decodeAbiString,
  parseHexInt,
  probeEndpoint,
  resolveCheckedRpc,
  checkToken,
  checkContractCode,
  rpcUrlsForChain,
  SELECTOR_DECIMALS,
  SELECTOR_SYMBOL,
  SELECTOR_NAME,
  EIP1967_IMPL_SLOT,
  readEip1967Impl,
};
