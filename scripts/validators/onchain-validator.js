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
 *     on-chain symbol decodes cleanly; tolerated only when `symbol()` reverts
 *     or returns an undecodable value, as some legitimate tokens do).
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

const {
  VALID_CHAIN_IDS,
  TESTNET_CHAIN_ID,
  RPC_URLS_BY_CHAIN_ID,
} = require('../utils/constants');

// ERC-20 read selectors (computed once; avoids pulling a full ABI/ethers
// Interface just for three constant 4-byte selectors).
const SELECTOR_DECIMALS = '0x313ce567'; // decimals()
const SELECTOR_SYMBOL = '0x95d89b41'; // symbol()

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
    throw new Error(`RPC ${url} is chain ${chainId}; expected ${expectedChainId}`);
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
      failures.push(`${url}: ${e.message}`);
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

/**
 * Check a single token against its chain. Returns
 * { errors: [], warnings: [] }.
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

  // decimals() — hard check
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

  // symbol() — hard when it decodes cleanly: a readable on-chain symbol that
  // disagrees with the registry is exactly the phishing-substitution vector
  // this validator exists to block. Reverting/undecodable symbols (bytes32
  // tokens etc.) are the only tolerated case.
  try {
    const symRaw = await ethCall(url, token.address, SELECTOR_SYMBOL, fetchImpl, timeoutMs);
    const onChainSymbol = decodeAbiString(symRaw);
    if (onChainSymbol && onChainSymbol.toUpperCase() !== token.symbol.toUpperCase()) {
      errors.push(
        `${label}: on-chain symbol "${onChainSymbol}" != declared "${token.symbol}"`
      );
    }
  } catch (e) {
    warnings.push(`${label}: symbol() call failed (tolerated): ${e.message}`);
  }

  return { errors, warnings };
}

/**
 * Check a single contract entry: code must exist on its declared chain.
 */
async function checkContractCode(url, contract, projectSlug, fetchImpl, timeoutMs) {
  const label = `${projectSlug}/${contract.name} (${contract.address})`;
  const code = await getCode(url, contract.address, fetchImpl, timeoutMs);
  if (!code || code === '0x') {
    return [`${label}: no contract code at address on chain ${contract.chainId}`];
  }
  return [];
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
        const errs = await checkContractCode(rpcUrl, contract, projectSlug, fetchImpl, timeoutMs);
        if (errs.length) {
          errs.forEach(msg => { errors++; (log.error || log.log)(`  ❌ ${msg}`); });
        } else {
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
};
