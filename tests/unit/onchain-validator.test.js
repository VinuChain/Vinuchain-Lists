/**
 * Unit tests for the on-chain cross-check validator (addresses AUD-01).
 * Uses a mocked fetch so no network is required.
 */

const { expect } = require('chai');
const { keccak256 } = require('ethers');
const {
  runOnchainChecks,
  decodeAbiString,
  parseHexInt,
  SELECTOR_DECIMALS,
  SELECTOR_SYMBOL,
  SELECTOR_NAME,
  EIP1967_IMPL_SLOT,
} = require('../../scripts/validators/onchain-validator');

// keccak256 of a piece of deployed bytecode — the value a real codeHash pin holds.
function hashOf(code) {
  return keccak256(code);
}

// Encode a JS string as an ABI-encoded dynamic `string` return value.
function encodeAbiString(str) {
  const bytes = Buffer.from(str, 'utf8');
  const lenHex = bytes.length.toString(16).padStart(64, '0');
  const offset = '0'.repeat(62) + '20';
  let dataHex = bytes.toString('hex');
  while (dataHex.length % 64 !== 0) dataHex += '0';
  return '0x' + offset + lenHex + dataHex;
}

function uintHex(n) {
  return '0x' + n.toString(16).padStart(64, '0');
}

// Encode an address as a 32-byte storage slot value (low 20 bytes = address).
function encodeAddr(addr) {
  const hex = addr.startsWith('0x') ? addr.slice(2) : addr;
  return '0x' + hex.toLowerCase().padStart(64, '0');
}

/**
 * Build a fake fetch over a routing table.
 *
 * accounts: { [address]: { code, decimals?, symbol?, name?, implSlot? } }
 *   - code: hex bytecode returned by eth_getCode
 *   - decimals: integer returned by decimals()
 *   - symbol: string returned by symbol()
 *   - name: string returned by name()
 *   - implSlot: address string — value returned by eth_getStorageAt(EIP1967_IMPL_SLOT)
 *
 * failChainId: if true, throw ECONNREFUSED on every call.
 */
function makeFetch({ chainId = 207, accounts = {}, failChainId = false } = {}) {
  return async function fakeFetch(_url, init) {
    const req = JSON.parse(init.body);
    const ok = (result) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    });
    if (failChainId) throw new Error('ECONNREFUSED');

    switch (req.method) {
      case 'eth_chainId':
        return ok(uintHex(chainId).replace(/^0x0+/, '0x'));
      case 'eth_blockNumber':
        return ok('0x100');

      case 'eth_getCode': {
        const addr = req.params[0].toLowerCase();
        // Look up case-insensitively
        const acct = Object.entries(accounts).find(([k]) => k.toLowerCase() === addr)?.[1];
        return ok(acct && acct.code ? acct.code : '0x');
      }

      case 'eth_getStorageAt': {
        const addr = req.params[0].toLowerCase();
        const slot = req.params[1];
        const acct = Object.entries(accounts).find(([k]) => k.toLowerCase() === addr)?.[1];
        // Only handle the EIP-1967 impl slot
        if (slot === EIP1967_IMPL_SLOT && acct && acct.implSlot) {
          return ok(encodeAddr(acct.implSlot));
        }
        // Slot not set — return zero
        return ok('0x' + '0'.repeat(64));
      }

      case 'eth_call': {
        const to = req.params[0].to.toLowerCase();
        const data = req.params[0].data;
        const acct = Object.entries(accounts).find(([k]) => k.toLowerCase() === to)?.[1] || {};
        if (data === SELECTOR_DECIMALS) {
          if (acct.decimals === undefined) throw new Error('execution reverted');
          return ok(uintHex(acct.decimals));
        }
        if (data === SELECTOR_SYMBOL) {
          if (acct.symbol === undefined) throw new Error('execution reverted');
          return ok(encodeAbiString(acct.symbol));
        }
        if (data === SELECTOR_NAME) {
          if (acct.name === undefined) throw new Error('execution reverted');
          return ok(encodeAbiString(acct.name));
        }
        throw new Error('unexpected call');
      }

      default:
        throw new Error(`unexpected method ${req.method}`);
    }
  };
}

const silentLog = { error() {}, warn() {}, info() {}, success() {}, log() {} };

// ---------------------------------------------------------------------------
describe('on-chain validator', () => {
  describe('decodeAbiString', () => {
    it('decodes a dynamic string', () => {
      expect(decodeAbiString(encodeAbiString('USDT'))).to.equal('USDT');
    });
    it('returns null for empty', () => {
      expect(decodeAbiString('0x')).to.equal(null);
    });
  });

  describe('parseHexInt', () => {
    it('parses hex quantities', () => {
      expect(parseHexInt('0x12')).to.equal(18);
    });
    it('throws on non-hex', () => {
      expect(() => parseHexInt('18')).to.throw();
    });
  });

  // -------------------------------------------------------------------------
  describe('token checks', () => {
    const token = {
      symbol: 'USDT',
      name: 'USDT@VinuChain',
      address: '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41',
      decimals: 6,
      chainId: 207,
    };

    // Pinned token: codeHash = keccak256('0x6080')
    const pinnedToken = { ...token, codeHash: hashOf('0x6080') };

    it('passes (with not-pinned warning) when code, decimals, and symbol all match', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [token.address]: { code: '0x6080', decimals: 6, symbol: 'USDT' } },
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
      // One warning: "no codeHash pin"
      expect(r.warnings).to.equal(1);
    });

    it('passes with ZERO warnings when codeHash matches and symbol matches', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [pinnedToken.address]: { code: '0x6080', decimals: 6, symbol: 'USDT' } },
      });
      const r = await runOnchainChecks({ tokens: [pinnedToken], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
      expect(r.warnings).to.equal(0);
    });

    it('errors when address has no code (EOA / wrong address)', async () => {
      const fetchImpl = makeFetch({ chainId: 207, accounts: {} });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });

    it('errors when on-chain decimals mismatch declared', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [token.address]: { code: '0x6080', decimals: 18, symbol: 'USDT' } },
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });

    it('hard-errors when a cleanly-decoded on-chain symbol differs (phishing substitution)', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [token.address]: { code: '0x6080', decimals: 6, symbol: 'USDC' } },
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });

    it('HARD-ERRORS when on-chain codeHash mismatches the pin (wrong contract type)', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [pinnedToken.address]: { code: '0xdeadbeef', decimals: 6, symbol: 'USDT' } },
      });
      const r = await runOnchainChecks({ tokens: [pinnedToken], fetchImpl, log: silentLog });
      expect(r.errors).to.be.greaterThan(0);
    });

    it('HARD-ERRORS when symbol() reverts AND no name() — no per-instance identity', async () => {
      // Neither symbol nor name available — cannot distinguish instances
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [token.address]: { code: '0x6080', decimals: 6 } }, // no symbol, no name
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });

    it('HARD-ERRORS when symbol() reverts AND no name() EVEN WITH a matching codeHash', async () => {
      // codeHash pins type, not instance — identical-bytecode tokens exist in the registry
      // (BTC/USDT/ETH share one codeHash). So codeHash alone is not sufficient.
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [pinnedToken.address]: { code: '0x6080', decimals: 6 } }, // no symbol, no name
      });
      const r = await runOnchainChecks({ tokens: [pinnedToken], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1); // fail-closed: codeHash alone cannot distinguish instances
    });

    it('PASSES when symbol() reverts but name() matches (fallback instance signal)', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: {
          [token.address]: { code: '0x6080', decimals: 6, name: 'USDT@VinuChain' }, // no symbol
        },
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
    });

    it('PASSES with codeHash + matching name() when symbol() reverts', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: {
          [pinnedToken.address]: { code: '0x6080', decimals: 6, name: 'USDT@VinuChain' },
        },
      });
      const r = await runOnchainChecks({ tokens: [pinnedToken], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
    });

    it('hard-errors when name() mismatches and symbol() reverted', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: {
          [token.address]: { code: '0x6080', decimals: 6, name: 'Wrong@VinuChain' },
        },
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });

    it('demonstrates two tokens with SAME codeHash are distinguished by symbol()', async () => {
      // BTC and USDT share identical bytecode in the real registry — they must
      // be distinguished by symbol(), not by codeHash. This test simulates that.
      const sharedCode = '0x6080';
      const sharedHash = hashOf(sharedCode);
      const btc = {
        symbol: 'BTC', name: 'BTC@VinuChain',
        address: '0x1111111111111111111111111111111111111111',
        decimals: 8, chainId: 207, codeHash: sharedHash,
      };
      const usdt = {
        symbol: 'USDT', name: 'USDT@VinuChain',
        address: '0x2222222222222222222222222222222222222222',
        decimals: 6, chainId: 207, codeHash: sharedHash,
      };
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: {
          [btc.address]:  { code: sharedCode, decimals: 8, symbol: 'BTC' },
          [usdt.address]: { code: sharedCode, decimals: 6, symbol: 'USDT' },
        },
      });
      const r = await runOnchainChecks({ tokens: [btc, usdt], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
    });

    it('catches substituted token: same codeHash but wrong symbol reveals the swap', async () => {
      const sharedCode = '0x6080';
      const sharedHash = hashOf(sharedCode);
      const btc = {
        symbol: 'BTC', name: 'BTC@VinuChain',
        address: '0x1111111111111111111111111111111111111111',
        decimals: 8, chainId: 207, codeHash: sharedHash,
      };
      // Attacker swapped BTC address with another factory token — same bytecode, wrong symbol
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: {
          [btc.address]: { code: sharedCode, decimals: 6, symbol: 'USDT' }, // wrong!
        },
      });
      const r = await runOnchainChecks({ tokens: [btc], fetchImpl, log: silentLog });
      expect(r.errors).to.be.greaterThan(0);
    });

    describe('EIP-1967 proxy implCodeHash checks for tokens', () => {
      const TOKEN_ADDR = '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41';
      const IMPL_ADDR  = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      const baseToken = {
        symbol: 'USDT', name: 'USDT@VinuChain',
        address: TOKEN_ADDR, decimals: 6, chainId: 207,
        codeHash: hashOf('0x6001'),
        implCodeHash: hashOf('0x6002'),
      };

      it('PASSES when proxy token codeHash and implCodeHash both match', async () => {
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [TOKEN_ADDR]: { code: '0x6001', decimals: 6, symbol: 'USDT', implSlot: IMPL_ADDR },
            [IMPL_ADDR]:  { code: '0x6002' },
          },
        });
        const r = await runOnchainChecks({ tokens: [baseToken], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(0);
        expect(r.warnings).to.equal(0);
      });

      it('HARD-ERRORS when proxy token detected on-chain but implCodeHash is NOT in JSON', async () => {
        // Deleting implCodeHash from a token JSON cannot bypass the check —
        // the chain itself reports a nonzero impl slot.
        const unpinned = { ...baseToken, implCodeHash: undefined };
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [TOKEN_ADDR]: { code: '0x6001', decimals: 6, symbol: 'USDT', implSlot: IMPL_ADDR },
            [IMPL_ADDR]:  { code: '0x6002' },
          },
        });
        const r = await runOnchainChecks({ tokens: [unpinned], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(1);
      });

      it('PASSES when non-proxy token has slot zero and no implCodeHash', async () => {
        // Standard ERC-20 (no proxy): slot is zero, no implCodeHash required.
        const plain = { ...baseToken, implCodeHash: undefined };
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [TOKEN_ADDR]: { code: '0x6001', decimals: 6, symbol: 'USDT' }, // no implSlot
          },
        });
        const r = await runOnchainChecks({ tokens: [plain], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(0);
        expect(r.warnings).to.equal(0);
      });

      it('HARD-ERRORS when token declares implCodeHash but EIP-1967 slot is zero (stale/substituted)', async () => {
        // Token JSON has implCodeHash but the chain reports slot=0 — either the
        // implementation was cleared or the address was substituted.
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [TOKEN_ADDR]: { code: '0x6001', decimals: 6, symbol: 'USDT' }, // no implSlot
          },
        });
        const r = await runOnchainChecks({ tokens: [baseToken], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('contract checks', () => {
    const entry = {
      projectSlug: 'vinuswap',
      contract: {
        name: 'SwapRouter',
        address: '0x48f450475a8b501A7480C1Fd02935a7327F713Ad',
        type: 'periphery',
        chainId: 207,
      },
    };

    it('passes when contract code exists, but WARNS it is not pinned', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [entry.contract.address]: { code: '0x6080' } },
      });
      const r = await runOnchainChecks({ contracts: [entry], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
      expect(r.warnings).to.equal(1);
    });

    it('passes with ZERO warnings when a matching codeHash pins the contract', async () => {
      const pinned = { ...entry, contract: { ...entry.contract, codeHash: hashOf('0x6080') } };
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [pinned.contract.address]: { code: '0x6080' } },
      });
      const r = await runOnchainChecks({ contracts: [pinned], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
      expect(r.warnings).to.equal(0);
    });

    it('HARD-ERRORS when a pinned contract serves different bytecode (wrong type)', async () => {
      const pinned = { ...entry, contract: { ...entry.contract, codeHash: hashOf('0x6080') } };
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [pinned.contract.address]: { code: '0xdeadbeef' } },
      });
      const r = await runOnchainChecks({ contracts: [pinned], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });

    it('errors when contract has no code', async () => {
      const fetchImpl = makeFetch({ chainId: 207, accounts: {} });
      const r = await runOnchainChecks({ contracts: [entry], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });

    describe('EIP-1967 proxy implCodeHash checks', () => {
      const IMPL_ADDR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const PROXY_ADDR = '0x48f450475a8b501A7480C1Fd02935a7327F713Ad';

      // Fully-pinned proxy entry (codeHash + implCodeHash both set).
      const proxyEntry = {
        projectSlug: 'vinuchain',
        contract: {
          name: 'OptimizedTransparentUpgradeableProxy',
          address: PROXY_ADDR,
          type: 'staking',
          chainId: 207,
          codeHash: hashOf('0x6001'),
          implCodeHash: hashOf('0x6002'),
        },
      };

      it('PASSES when proxy codeHash and implCodeHash both match', async () => {
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [PROXY_ADDR]: { code: '0x6001', implSlot: IMPL_ADDR },
            [IMPL_ADDR]:  { code: '0x6002' },
          },
        });
        const r = await runOnchainChecks({ contracts: [proxyEntry], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(0);
        expect(r.warnings).to.equal(0);
      });

      it('HARD-ERRORS when impl bytecode mismatches the pin (implementation replaced)', async () => {
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [PROXY_ADDR]: { code: '0x6001', implSlot: IMPL_ADDR },
            [IMPL_ADDR]:  { code: '0xdeadbeef' }, // valid hex, different bytecode → real keccak mismatch
          },
        });
        const r = await runOnchainChecks({ contracts: [proxyEntry], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(1);
      });

      it('HARD-ERRORS when proxy detected on-chain but implCodeHash is NOT in the JSON', async () => {
        // Deleting implCodeHash from the JSON cannot bypass the check — the chain
        // itself reports a nonzero impl slot, so the validator hard-errors regardless.
        const unpinned = {
          ...proxyEntry,
          contract: { ...proxyEntry.contract, implCodeHash: undefined },
        };
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [PROXY_ADDR]: { code: '0x6001', implSlot: IMPL_ADDR },
            [IMPL_ADDR]:  { code: '0x6002' },
          },
        });
        const r = await runOnchainChecks({ contracts: [unpinned], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(1);
      });

      it('HARD-ERRORS when impl slot is nonzero but implCodeHash absent (no codeHash either)', async () => {
        // Same bypass-attempt with no codeHash either — still a hard error.
        const bare = {
          projectSlug: 'test',
          contract: { name: 'BareProxy', address: PROXY_ADDR, type: 'other', chainId: 207 },
        };
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [PROXY_ADDR]: { code: '0x6001', implSlot: IMPL_ADDR },
            [IMPL_ADDR]:  { code: '0x6002' },
          },
        });
        const r = await runOnchainChecks({ contracts: [bare], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(1);
      });

      it('HARD-ERRORS when EIP-1967 slot is zero but entry declares implCodeHash (stale/substituted)', async () => {
        // The entry pins an implCodeHash but the chain reports slot=0 — either the
        // implementation was cleared (deactivated proxy) or the address was substituted
        // with a non-proxy contract. Both are hard errors.
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [PROXY_ADDR]: { code: '0x6001' }, // no implSlot → slot returns zero
          },
        });
        const r = await runOnchainChecks({ contracts: [proxyEntry], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(1);
      });

      it('HARD-ERRORS when impl address has no code', async () => {
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [PROXY_ADDR]: { code: '0x6001', implSlot: IMPL_ADDR },
            // IMPL_ADDR absent → eth_getCode returns '0x'
          },
        });
        const r = await runOnchainChecks({ contracts: [proxyEntry], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(1);
      });

      it('non-proxy contract (impl slot zero) passes without implCodeHash', async () => {
        // A plain non-proxy entry with codeHash but no implCodeHash. The impl
        // slot is zero → no proxy requirement → no error or warning from impl.
        const plain = {
          ...proxyEntry,
          contract: {
            ...proxyEntry.contract,
            implCodeHash: undefined,
            // implSlot NOT set in accounts → slot returns zero
          },
        };
        const fetchImpl = makeFetch({
          chainId: 207,
          accounts: {
            [PROXY_ADDR]: { code: '0x6001' }, // no implSlot → not a proxy
          },
        });
        const r = await runOnchainChecks({ contracts: [plain], fetchImpl, log: silentLog });
        expect(r.errors).to.equal(0);
        expect(r.warnings).to.equal(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('chain-ID guard', () => {
    it('errors on mainnet (207) when the RPC reports the wrong chain', async () => {
      const token = {
        symbol: 'X', name: 'X', address: '0x1111111111111111111111111111111111111111',
        decimals: 18, chainId: 207,
      };
      const fetchImpl = makeFetch({ chainId: 1 });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.be.greaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('testnet outage tolerance', () => {
    const testnetToken = {
      symbol: 'T', name: 'T', address: '0x2222222222222222222222222222222222222222',
      decimals: 18, chainId: 206,
    };

    it('skips testnet (206) with a warning when the RPC is down', async () => {
      const fetchImpl = makeFetch({ failChainId: true });
      const r = await runOnchainChecks({ tokens: [testnetToken], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
      expect(r.warnings).to.equal(1);
      expect(r.skippedChains).to.deep.equal([206]);
    });

    it('HARD-ERRORS (not skip) when the testnet RPC answers for the WRONG chain', async () => {
      // A reachable TESTNET_RPC_URL that returns chainId 207 for a 206 entry is
      // a misconfiguration, not an outage — it must fail, not be tolerated,
      // otherwise every 206 check is silently skipped and CI passes.
      const fetchImpl = makeFetch({ chainId: 207 }); // reachable, but wrong chain
      const r = await runOnchainChecks({ tokens: [testnetToken], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
      expect(r.skippedChains).to.deep.equal([]);
    });

    it('fails testnet outage when ONCHAIN_STRICT_TESTNET is forced', async () => {
      const fetchImpl = makeFetch({ failChainId: true });
      const r = await runOnchainChecks({
        tokens: [testnetToken], fetchImpl, log: silentLog, strictTestnet: true,
      });
      expect(r.errors).to.equal(1);
      expect(r.skippedChains).to.deep.equal([]);
    });

    it('does NOT tolerate a mainnet (207) outage', async () => {
      const mainnetToken = { ...testnetToken, chainId: 207 };
      const fetchImpl = makeFetch({ failChainId: true });
      const r = await runOnchainChecks({ tokens: [mainnetToken], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });
  });
});
