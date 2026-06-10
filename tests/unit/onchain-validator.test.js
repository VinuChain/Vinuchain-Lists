/**
 * Unit tests for the on-chain cross-check validator (addresses AUD-01).
 * Uses a mocked fetch so no network is required; exercises the code-missing,
 * decimals-mismatch, symbol-mismatch, chain-ID-guard, and testnet-skip paths.
 */

const { expect } = require('chai');
const {
  runOnchainChecks,
  decodeAbiString,
  parseHexInt,
  SELECTOR_DECIMALS,
  SELECTOR_SYMBOL,
} = require('../../scripts/validators/onchain-validator');

// Encode a JS string as an ABI-encoded dynamic `string` return value.
function encodeAbiString(str) {
  const bytes = Buffer.from(str, 'utf8');
  const lenHex = bytes.length.toString(16).padStart(64, '0');
  const offset = '0'.repeat(62) + '20';
  let dataHex = bytes.toString('hex');
  // pad to 32-byte boundary
  while (dataHex.length % 64 !== 0) dataHex += '0';
  return '0x' + offset + lenHex + dataHex;
}

function uintHex(n) {
  return '0x' + n.toString(16).padStart(64, '0');
}

// Build a fake fetch over a routing table:
//   chainId: number returned by eth_chainId
//   accounts: { [address]: { code, decimals, symbol } }
function makeFetch({ chainId = 207, accounts = {}, failChainId = false } = {}) {
  return async function fakeFetch(_url, init) {
    const req = JSON.parse(init.body);
    const ok = (result) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    });
    if (failChainId) {
      throw new Error('ECONNREFUSED');
    }
    switch (req.method) {
      case 'eth_chainId':
        return ok(uintHex(chainId).replace(/^0x0+/, '0x'));
      case 'eth_blockNumber':
        return ok('0x100');
      case 'eth_getCode': {
        const addr = req.params[0];
        const acct = accounts[addr];
        return ok(acct && acct.code ? acct.code : '0x');
      }
      case 'eth_call': {
        const to = req.params[0].to;
        const data = req.params[0].data;
        const acct = accounts[to] || {};
        if (data === SELECTOR_DECIMALS) {
          if (acct.decimals === undefined) throw new Error('execution reverted');
          return ok(uintHex(acct.decimals));
        }
        if (data === SELECTOR_SYMBOL) {
          if (acct.symbol === undefined) throw new Error('execution reverted');
          return ok(encodeAbiString(acct.symbol));
        }
        throw new Error('unexpected call');
      }
      default:
        throw new Error(`unexpected method ${req.method}`);
    }
  };
}

const silentLog = { error() {}, warn() {}, info() {}, success() {}, log() {} };

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

  describe('token checks', () => {
    const token = {
      symbol: 'USDT',
      name: 'USDT@VinuChain',
      address: '0xC0264277fcCa5FCfabd41a8bC01c1FcAF8383E41',
      decimals: 6,
      chainId: 207,
    };

    it('passes when code, decimals, and symbol all match', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [token.address]: { code: '0x6080', decimals: 6, symbol: 'USDT' } },
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
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
      expect(r.warnings).to.equal(0);
    });

    it('tolerates a token whose symbol() reverts (bytes32/non-standard)', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [token.address]: { code: '0x6080', decimals: 6 } }, // no symbol
      });
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
      expect(r.warnings).to.equal(1); // advisory warning, not a failure
    });
  });

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

    it('passes when contract code exists', async () => {
      const fetchImpl = makeFetch({
        chainId: 207,
        accounts: { [entry.contract.address]: { code: '0x6080' } },
      });
      const r = await runOnchainChecks({ contracts: [entry], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(0);
    });

    it('errors when contract has no code', async () => {
      const fetchImpl = makeFetch({ chainId: 207, accounts: {} });
      const r = await runOnchainChecks({ contracts: [entry], fetchImpl, log: silentLog });
      expect(r.errors).to.equal(1);
    });
  });

  describe('chain-ID guard', () => {
    it('errors on mainnet (207) when the RPC reports the wrong chain', async () => {
      const token = {
        symbol: 'X', name: 'X', address: '0x1111111111111111111111111111111111111111',
        decimals: 18, chainId: 207,
      };
      const fetchImpl = makeFetch({ chainId: 1 }); // RPC is on a different chain
      const r = await runOnchainChecks({ tokens: [token], fetchImpl, log: silentLog });
      expect(r.errors).to.be.greaterThan(0);
    });
  });

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
