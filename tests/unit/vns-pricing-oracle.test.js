const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), 'utf8');
}

function abi(filePath) {
  return JSON.parse(read(filePath));
}

function names(items) {
  return items.map(item => item.name).filter(Boolean);
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n');
}

describe('VNS pricing oracle registry', () => {
  it('parses ordered RPC fallback lists without leaking full URLs in diagnostics', () => {
    const updater = require('../../scripts/update-vns-oracle');

    expect(
      updater.parseRpcUrls(
        'https://primary.example/rpc, https://backup.example/rpc',
        'https://legacy.example/rpc\nhttps://space.example/rpc',
      ),
    ).to.deep.equal([
      'https://primary.example/rpc',
      'https://backup.example/rpc',
      'https://legacy.example/rpc',
      'https://space.example/rpc',
    ]);
    expect(
      updater.rpcUrlsWithFallback(
        'https://default.example/rpc',
        'https://configured.example/rpc',
      ),
    ).to.deep.equal(['https://configured.example/rpc']);
    expect(updater.rpcUrlsWithFallback('https://default.example/rpc', '')).to.deep.equal([
      'https://default.example/rpc',
    ]);
    expect(updater.describeRpcUrl('https://rpc.example/secret-token')).to.equal(
      'https://rpc.example',
    );
    expect(
      updater.sanitizeRpcError(
        new Error('failed https://rpc.example/secret-token'),
        ['https://rpc.example/secret-token'],
      ),
    ).to.equal('failed [rpc-1]');
    expect(
      updater.sanitizeRpcError(
        new Error('failed https://rpc.example/secret-token-extra'),
        ['https://rpc.example/secret-token', 'https://rpc.example/secret-token-extra'],
      ),
    ).to.equal('failed [rpc-2]');
  });

  it('keeps the USD rent curve owner-governed and VC-enforced through the oracle', () => {
    const stableOracle = read('contracts/vns/source/contracts/ethregistrar/StablePriceOracle.sol');
    const controller = read('contracts/vns/source/contracts/ethregistrar/ETHRegistrarController.sol');

    expect(stableOracle).to.include('contract StablePriceOracle is IPriceOracle, Ownable');
    expect(stableOracle).to.include('function setRentPrices');
    expect(stableOracle).to.include('external onlyOwner');
    expect(stableOracle).to.include('return (amount * 1e8) / ethPrice;');

    expect(controller).to.include('IPriceOracle.Price memory price = _rentPrice');
    expect(controller).to.include('if (msg.value < totalPrice) revert InsufficientValue();');
    expect(controller).to.include('if (msg.value < price.base) revert InsufficientValue();');
  });

  it('guards automated oracle updates with the target chain and V3 TWAP pricing', () => {
    const updater = read('scripts/update-vns-oracle.js');

    expect(updater).to.include("'https://vinufoundation-rpc.com'");
    expect(updater).to.include('process.env.VNS_ORACLE_RPC_URLS');
    expect(updater).to.include('resolveCheckedProvider(');
    expect(updater).to.include("await rawJsonRpc(url, 'eth_blockNumber')");
    expect(updater).to.include(
      'const EXPECTED_TARGET_CHAIN_ID = Number(process.env.VNS_ORACLE_CHAIN_ID || 206)',
    );
    expect(updater).to.include("await rawJsonRpc(url, 'eth_chainId')");
    expect(updater).to.include("'function observe(uint32[] secondsAgos) view returns");
    expect(updater).to.not.include('balanceOf(poolAddress)');
    expect(updater).to.include('const price = await resolveVnsOraclePrice(targetChainId);');

    // The strict gate is no longer keyed on chain id. It used to force strict on
    // mainnet, on the assumption that the pool corroborated the price. It does
    // not: all three VinuChain pools have observationCardinality 1, so observe()
    // returns spot rather than a TWAP. Forcing strict against a spot quote
    // guarantees an outage (guard fails -> no update -> StaleAnswer ->
    // rentPrice() reverts) while defending nothing, since the pool was never the
    // price source. The gate now keys on whether a real TWAP exists, so growing
    // a pool's observation buffer re-arms it with no code change.
    expect(updater).to.include('const observationCardinality = Number(');
    expect(updater).to.include('const isRealTwap = observationCardinality > 1;');
    expect(updater).to.include('const poolCanCorroborate = pool ? Boolean(pool.isRealTwap) : true;');
    expect(updater).to.include(
      'poolCanCorroborate && requirePoolGuard && !allowSingleSource',
    );
    expect(updater).to.not.include('targetChainId === MAINNET_CHAIN_ID');
  });

  it('keeps oracle maxAge defaults consistent across deploy, update, and workflow paths', () => {
    const deployer = read('scripts/deploy-vns-oracle-stack.js');
    const updater = read('scripts/update-vns-oracle.js');
    const workflow = read('.github/workflows/vns-oracle-update.yml');

    expect(deployer).to.include(
      'const ORACLE_MAX_AGE = BigInt(process.env.VNS_ORACLE_MAX_AGE_SECONDS || 12 * 60 * 60);',
    );
    expect(updater).to.include('function readRecordedOracleMaxAgeSeconds()');
    expect(updater).to.include('deployment.oracleStack?.oracleMaxAgeSeconds');
    expect(updater).to.include('return readRecordedOracleMaxAgeSeconds() || 12n * 60n * 60n;');
    expect(workflow).to.not.include('VNS_EXPECTED_ORACLE_MAX_AGE_SECONDS');
    expect(workflow).to.include('VNS_ORACLE_RPC_URLS');
    expect(workflow).to.include('vars.VNS_ORACLE_RPC_URLS || vars.VNS_ORACLE_RPC_URL');
    expect(workflow).to.include("cron: '17 */4 * * *'");
  });

  it('caps VinuUsdOracle setter rails so owner cannot widen tolerances in a single tx', () => {
    const oracle = read('contracts/vns/VinuUsdOracle.sol');
    const mirror = read('contracts/vns/source/contracts/ethregistrar/VinuUsdOracle.sol');

    // Mirror invariant — top-level .sol must match source/contracts/.sol.
    expect(oracle).to.equal(mirror);

    // Three ceiling constants must be public so they're observable on-chain.
    expect(oracle).to.include('uint256 public constant MAX_CHANGE_BPS_CEILING = 2_000;');
    expect(oracle).to.include('uint256 public constant MAX_AGE_CEILING = 12 hours;');
    expect(oracle).to.include('uint256 public constant BOUNDS_WIDEN_FACTOR_CEILING = 2;');

    // Each ceiling enforced in the matching internal setter.
    expect(oracle).to.include('if (newMaxChangeBps > MAX_CHANGE_BPS_CEILING)');
    expect(oracle).to.include('revert MaxChangeBpsAboveCeiling(');
    expect(oracle).to.include('if (newMaxAge > MAX_AGE_CEILING)');
    expect(oracle).to.include('revert MaxAgeAboveCeiling(');
    expect(oracle).to.include('uint256 ceiling = priorWidth * BOUNDS_WIDEN_FACTOR_CEILING;');
    expect(oracle).to.include('revert BoundsWidenedTooMuch(');

    // First-set exemption: uninitialized state (minAnswer == 0) skips the widening cap.
    expect(oracle).to.include('if (minAnswer != 0)');
  });

  it('keeps the VinuUsdOracle artifact and build-info source aligned with the checked-in source', () => {
    const oracle = read('contracts/vns/source/contracts/ethregistrar/VinuUsdOracle.sol');
    const artifact = JSON.parse(
      read('contracts/vns/source/artifacts/contracts/ethregistrar/VinuUsdOracle.sol/VinuUsdOracle.json'),
    );
    const buildInfo = JSON.parse(
      read(`contracts/vns/source/artifacts/build-info/${artifact.buildInfoId}.json`),
    );
    const compiledSource =
      buildInfo.input.sources[artifact.inputSourceName]?.content;
    const abiNames = names(artifact.abi);

    expect(normalizeNewlines(compiledSource)).to.equal(normalizeNewlines(oracle));
    expect(abiNames).to.include('MAX_AGE_CEILING');
    expect(abiNames).to.include('MAX_CHANGE_BPS_CEILING');
    expect(abiNames).to.include('BOUNDS_WIDEN_FACTOR_CEILING');
    expect(abiNames).to.include('MaxAgeAboveCeiling');
    expect(abiNames).to.include('BoundsWidenedTooMuch');
  });

  it('publishes ABI entries for owner-controlled rent price updates', () => {
    const stableAbi = abi('contracts/vns/abis/contracts/ethregistrar/StablePriceOracle.sol/StablePriceOracle_abi.json');
    const exponentialAbi = abi(
      'contracts/vns/abis/contracts/ethregistrar/ExponentialPremiumPriceOracle.sol/ExponentialPremiumPriceOracle_abi.json',
    );
    const flatExponentialAbi = abi('contracts/vns/ExponentialPremiumPriceOracle_abi.json');

    for (const contractAbi of [stableAbi, exponentialAbi, flatExponentialAbi]) {
      const entryNames = names(contractAbi);
      expect(entryNames).to.include('owner');
      expect(entryNames).to.include('setRentPrices');
      expect(entryNames).to.include('InvalidRentPrices');
      expect(entryNames).to.include('RentPriceChanged');
    }
  });
});


describe('reconcileVnsPrice deviation / pool-advisory policy', () => {
  const { reconcileVnsPrice, toOracleSourceTag } = require('../../scripts/update-vns-oracle');
  const cg = { usd: 0.0003, source: 'coingecko', updatedAt: 1234567890 };
  // ~1% apart (within cap) and ~21% apart (over the 500 bps cap)
  // isRealTwap distinguishes a pool with a grown observation buffer (a genuine
  // TWAP, allowed to veto) from one at cardinality 1 (spot in disguise, not
  // allowed to veto). All three live VinuChain pools are the latter today.
  const poolClose = { usd: 0.000303, source: 'v3-twap', priceChainId: 207, deviationBps: 10, isRealTwap: true, pools: [] };
  const poolFar = { usd: 0.00037, source: 'v3-twap', priceChainId: 207, deviationBps: 10, isRealTwap: true, pools: [] };
  const poolFarSpotOnly = { ...poolFar, source: 'v3-spot', isRealTwap: false };

  it('returns coingecko+v3-twap when both sources agree within the cap', () => {
    const r = reconcileVnsPrice({
      coingecko: cg, pool: poolClose,
      requirePoolGuard: true, allowSingleSource: false, maxDeviationBps: 500,
    });
    expect(r.source).to.equal('coingecko+v3-twap');
    expect(r.usd).to.equal(cg.usd);
  });

  it('throws on deviation in strict mode (pool required, single-source disallowed)', () => {
    expect(() => reconcileVnsPrice({
      coingecko: cg, pool: poolFar,
      requirePoolGuard: true, allowSingleSource: false, maxDeviationBps: 500,
    })).to.throw(/deviation .* exceeds 500/);
  });

  it('falls back to CoinGecko on deviation when single-source is allowed (testnet send)', () => {
    const r = reconcileVnsPrice({
      coingecko: cg, pool: poolFar,
      requirePoolGuard: true, allowSingleSource: true, maxDeviationBps: 500,
      targetChainId: 206,
    });
    expect(r.usd).to.equal(cg.usd);
    expect(r.source).to.match(/pool advisory/);
    expect(toOracleSourceTag(r.source)).to.equal('coingecko-pool-advisory');
    expect(r.poolUsd).to.equal(poolFar.usd);
    expect(r.deviationBps).to.be.greaterThan(500);
  });

  it('still hard-fails a deviation against a REAL TWAP under the guard, on any chain', () => {
    for (const targetChainId of [206, 207]) {
      expect(() => reconcileVnsPrice({
        coingecko: cg, pool: poolFar,
        requirePoolGuard: true, allowSingleSource: false, maxDeviationBps: 500,
        targetChainId,
      })).to.throw(/deviation .* exceeds 500/);
    }
  });

  it('labels the on-chain source spot, not twap, when the pool has no buffer', () => {
    const poolCloseSpotOnly = { ...poolClose, source: 'v3-spot', isRealTwap: false };
    const r = reconcileVnsPrice({
      coingecko: cg, pool: poolCloseSpotOnly,
      requirePoolGuard: true, allowSingleSource: false, maxDeviationBps: 500,
    });
    expect(r.source).to.equal('coingecko+v3-spot');
    expect(r.usd).to.equal(cg.usd);
  });

  it('does NOT let a cardinality-1 pool veto CoinGecko, including on mainnet', () => {
    // This is the reversal. A pool at cardinality 1 returns spot, not a TWAP, so
    // it corroborates nothing — and letting it veto causes the outage it looks
    // like it prevents: no update, then StaleAnswer, then rentPrice() reverts and
    // registration stops chain-wide. The on-chain maxChangeBps/minAnswer/maxAnswer
    // clamps remain the real manipulation defence.
    const r = reconcileVnsPrice({
      coingecko: cg, pool: poolFarSpotOnly,
      requirePoolGuard: true, allowSingleSource: false, maxDeviationBps: 500,
      targetChainId: 207,
    });
    expect(r.usd).to.equal(cg.usd);
    expect(r.source).to.match(/pool advisory/);
  });

  it('still requires the pool on mainnet when the read fails outright', () => {
    // A MISSING pool is an infrastructure failure, not a useless answer: the
    // operator asked for corroboration and the read never happened. That keeps
    // failing under the guard.
    expect(() => reconcileVnsPrice({
      coingecko: cg, pool: null, poolError: 'OLD',
      requirePoolGuard: true, allowSingleSource: false, maxDeviationBps: 500,
      targetChainId: 207,
    })).to.throw(/V3 TWAP guard failed/);
  });

  it('falls back to CoinGecko on deviation when the pool guard is off (testnet dry-run)', () => {
    const r = reconcileVnsPrice({
      coingecko: cg, pool: poolFar,
      requirePoolGuard: false, allowSingleSource: false, maxDeviationBps: 500,
      targetChainId: 206,
    });
    expect(r.usd).to.equal(cg.usd);
    expect(r.source).to.match(/pool advisory/);
  });

  it('maps verbose diagnostic sources to contract-safe on-chain source tags', () => {
    const tag = toOracleSourceTag('coingecko (pool advisory: deviation exceeded cap)');
    expect(tag).to.equal('coingecko-pool-advisory');
    expect(Buffer.byteLength(tag, 'utf8')).to.be.at.most(32);
    expect(toOracleSourceTag('coingecko+v3-twap')).to.equal('coingecko+v3-twap');
    // a cardinality-1 pool is reported as spot, and that tag must survive to
    // the chain unchanged and within the 32-byte limit
    expect(toOracleSourceTag('coingecko+v3-spot')).to.equal('coingecko+v3-spot');
    expect(Buffer.byteLength('coingecko+v3-spot', 'utf8')).to.be.at.most(32);
    expect(() => toOracleSourceTag('x'.repeat(33))).to.throw(/max is 32/);
  });

  it('requires the pool in strict mode when it is missing', () => {
    expect(() => reconcileVnsPrice({
      coingecko: cg, pool: null, poolError: 'OLD',
      requirePoolGuard: true, allowSingleSource: false, maxDeviationBps: 500,
    })).to.throw(/V3 TWAP guard failed/);
  });

  it('allows CoinGecko-only when not strict and the pool is missing', () => {
    const r = reconcileVnsPrice({
      coingecko: cg, pool: null, poolError: 'OLD',
      requirePoolGuard: false, allowSingleSource: false, maxDeviationBps: 500,
    });
    expect(r.usd).to.equal(cg.usd);
    expect(r.source).to.equal('coingecko');
  });

  it('throws when neither source is available', () => {
    expect(() => reconcileVnsPrice({
      coingecko: null, pool: null,
      requirePoolGuard: false, allowSingleSource: false, maxDeviationBps: 500,
    })).to.throw(/Unable to price VC/);
  });
});
