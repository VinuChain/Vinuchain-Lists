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

describe('VNS pricing oracle registry', () => {
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
    expect(updater).to.include(
      'const EXPECTED_TARGET_CHAIN_ID = Number(process.env.VNS_ORACLE_CHAIN_ID || 206)',
    );
    expect(updater).to.include("await assertChain(");
    expect(updater).to.include("'function observe(uint32[] secondsAgos) view returns");
    expect(updater).to.not.include('balanceOf(poolAddress)');
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
