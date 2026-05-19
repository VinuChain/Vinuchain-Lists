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
