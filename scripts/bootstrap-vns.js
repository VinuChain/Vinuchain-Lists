#!/usr/bin/env node
/**
 * Bootstrap the full VNS stack on a VinuChain network.
 *
 * Testnet was deployed by hand and no bootstrap script survived, which is why
 * its history contains four burned controllers, three retired bulk renewals and
 * two contracts that are permanently dead. This script exists so mainnet is
 * deployed once, in the right order, from a reviewable artefact.
 *
 * WHY THE ORDER MATTERS. Five bindings are set in a constructor with no setter:
 *   ExponentialPremiumPriceOracle.usdOracle
 *   ETHRegistrarController.prices
 *   StaticBulkRenewal.controller
 *   PublicResolver._trustedETHController
 *   BaseRegistrarImplementation.baseNode
 * Anything binding the controller MUST be deployed after the final controller.
 * Testnet did the reverse; renewAll() and the resolver's trusted path have been
 * dead ever since.
 *
 * RESUMABILITY. 31 steps against real money. Progress is written to the state
 * file after every step, and a re-run skips completed steps and re-verifies
 * them rather than redeploying. A failure at step 20 must never redo step 1.
 *
 * Root.lock is deliberately NOT part of this script. It is irreversible and
 * lives in lock-vinu-root.js behind its own confirmation.
 *
 * Usage:
 *   node scripts/bootstrap-vns.js --network testnet            # dry run (plan only)
 *   node scripts/bootstrap-vns.js --network testnet --send     # execute
 *   node scripts/bootstrap-vns.js --network mainnet --send     # after 2026-08-29
 *
 * Keys are read from .env (gitignored): VNS_NAMESPACE_ADMIN_KEY, VNS_ORACLE_UPDATER_KEY.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'contracts/vns/source/artifacts/contracts');

const NETWORKS = {
  testnet: { chainId: 206, rpc: 'https://vinufoundation-rpc.com', state: 'deployment-testnet-bootstrap.json' },
  mainnet: { chainId: 207, rpc: 'https://rpc.vinuchain.org', state: 'deployment-mainnet.json' },
};

// namehash("vinu") and labelhash("vinu"). BaseRegistrar takes the NAMEhash as
// its immutable baseNode; Root.setSubnodeOwner takes the LABELhash. Swapping
// them yields a stack that deploys cleanly and resolves nothing.
const NAMEHASH_VINU  = '0x8b2c096e21786c9afa7a1fedd1b69a27848cce61a49ec6363cd582b31efa6694';
const LABELHASH_VINU = '0xf51f7b42cfc94df97ddae258deab475433ad9c881402cfc605a5e6b28b861605';
const LABELHASH_REVERSE = ethers.keccak256(ethers.toUtf8Bytes('reverse'));
const LABELHASH_ADDR = ethers.keccak256(ethers.toUtf8Bytes('addr'));
const NAMEHASH_REVERSE = ethers.namehash('reverse');

// Decided 2026-08-21 — see vinuchain-ops-docs/smart-contracts/vns-mainnet-deploy-plan.md
const PARAMS = {
  rentPrices: [0n, 0n, 20294266869609n, 5073566717402n, 158548959919n], // $640/$160/$5 per yr for 3/4/5+
  startPremium: 10n ** 26n,   // $100M
  premiumDays: 21n,
  minCommitmentAge: 60n,
  maxCommitmentAge: 86400n,
  oracleMaxAge: 43200n,       // 12h — contract ceiling, testnet's 86400 cannot deploy
  oracleMinAnswer: 1000n,     // $0.00001 at 8 decimals
  oracleMaxAnswer: 1000000000n, // $10.00 — widening later is capped at 2x width per tx
  oracleMaxChangeBps: 2000n,  // already at MAX_CHANGE_BPS_CEILING
};

const ART = {
  ENSRegistry: 'registry/ENSRegistry.sol/ENSRegistry.json',
  Root: 'root/Root.sol/Root.json',
  ReverseRegistrar: 'reverseRegistrar/ReverseRegistrar.sol/ReverseRegistrar.json',
  DefaultReverseRegistrar: 'reverseRegistrar/DefaultReverseRegistrar.sol/DefaultReverseRegistrar.json',
  DefaultReverseResolver: 'reverseResolver/DefaultReverseResolver.sol/DefaultReverseResolver.json',
  BaseRegistrarImplementation: 'ethregistrar/BaseRegistrarImplementation.sol/BaseRegistrarImplementation.json',
  OwnedResolver: 'resolvers/OwnedResolver.sol/OwnedResolver.json',
  VinuUsdOracle: 'ethregistrar/VinuUsdOracle.sol/VinuUsdOracle.json',
  ExponentialPremiumPriceOracle: 'ethregistrar/ExponentialPremiumPriceOracle.sol/ExponentialPremiumPriceOracle.json',
  StaticMetadataService: 'wrapper/StaticMetadataService.sol/StaticMetadataService.json',
  NameWrapper: 'wrapper/NameWrapper.sol/NameWrapper.json',
  ETHRegistrarController: 'ethregistrar/ETHRegistrarController.sol/ETHRegistrarController.json',
  StaticBulkRenewal: 'ethregistrar/StaticBulkRenewal.sol/StaticBulkRenewal.json',
  PublicResolver: 'resolvers/PublicResolver.sol/PublicResolver.json',
  GatewayProvider: 'ccipRead/GatewayProvider.sol/GatewayProvider.json',
  UniversalResolver: 'universalResolver/UniversalResolver.sol/UniversalResolver.json',
};

const artifact = (n) => JSON.parse(fs.readFileSync(path.join(ARTIFACTS, ART[n]), 'utf8'));

function readKey(name) {
  const src = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = src.match(new RegExp(`^${name}=["' ]*(?:0x)?([0-9a-fA-F]{64})`, 'm'));
  if (!m) throw new Error(`${name} not found in .env`);
  return '0x' + m[1];
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

class State {
  constructor(file) {
    this.file = file;
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { contracts: {}, steps: {} };
  }
  done(step) { return Boolean(this.data.steps[step]); }
  addr(name) { return this.data.contracts[name]?.address; }
  record(step, payload) {
    this.data.steps[step] = { at: new Date().toISOString(), ...payload };
    this.save();
  }
  recordContract(name, address, txHash, blockNumber) {
    this.data.contracts[name] = { address, transactionHash: txHash, blockNumber };
    this.save();
  }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n'); }
}

async function main() {
  const netName = arg('--network', 'testnet');
  const net = NETWORKS[netName];
  if (!net) throw new Error(`unknown network ${netName}`);
  const send = process.argv.includes('--send');

  const gatewayUrl = arg('--gateway-url', netName === 'mainnet'
    ? 'https://offchain-resolver.vinuchain.org/' : 'https://offchain-resolver.vinuchain.org/');
  const metadataUri = arg('--metadata-uri', netName === 'mainnet'
    ? 'https://mainnet.vinuexplorer.org/name-services/metadata/{id}'
    : 'https://testnet.vinuexplorer.org/name-services/metadata/{id}');
  const initialAnswer = BigInt(arg('--initial-answer', '35270')); // 8 decimals

  const provider = new ethers.JsonRpcProvider(net.rpc, undefined, { staticNetwork: true });
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== net.chainId) throw new Error(`RPC is chain ${chainId}, expected ${net.chainId} for ${netName}`);

  const admin = new ethers.Wallet(readKey('VNS_NAMESPACE_ADMIN_KEY'), provider);
  const updater = new ethers.Wallet(readKey('VNS_ORACLE_UPDATER_KEY'), provider);
  const state = new State(path.join(ROOT, 'contracts/vns', net.state));

  console.log(`network        : ${netName} (chain ${chainId})`);
  console.log(`admin          : ${admin.address}  ${ethers.formatEther(await provider.getBalance(admin.address))} VC`);
  console.log(`updater        : ${updater.address}  ${ethers.formatEther(await provider.getBalance(updater.address))} VC`);
  console.log(`state file     : ${state.file}`);
  console.log(`gateway url    : ${gatewayUrl}`);
  console.log(`metadata uri   : ${metadataUri}`);
  console.log(`mode           : ${send ? 'SEND' : 'DRY RUN'}`);
  console.log('');

  // Chain governance must never own any part of VNS. Deploying as the final
  // owner is also what lets us skip the ten transferOwnership txs testnet needed.
  const FORBIDDEN = '0xf9c82b1117e8bea97843042521b8fbc93044f347';
  for (const w of [admin, updater]) {
    if (w.address.toLowerCase() === FORBIDDEN) {
      throw new Error('ABORT: chain-governance EOA must not own VNS (see vns-followups F2/F6)');
    }
  }

  const deploy = async (step, name, signer, args) => {
    if (state.done(step)) {
      const a = state.addr(name);
      const code = await provider.getCode(a);
      if (code === '0x') throw new Error(`state says ${name} at ${a} but there is no code there`);
      console.log(`[${step}] ${name.padEnd(30)} SKIP (already at ${a})`);
      return a;
    }
    if (!send) { console.log(`[${step}] ${name.padEnd(30)} would deploy(${args.map(String).join(', ')})`); return `<${name}>`; }
    const art = artifact(name);
    const f = new ethers.ContractFactory(art.abi, art.bytecode, signer);
    const c = await f.deploy(...args);
    const tx = c.deploymentTransaction();
    await c.waitForDeployment();
    const a = await c.getAddress();
    const rcpt = await provider.getTransactionReceipt(tx.hash);
    state.recordContract(name, a, tx.hash, rcpt.blockNumber);
    state.record(step, { action: 'deploy', name, address: a, tx: tx.hash });
    console.log(`[${step}] ${name.padEnd(30)} ${a}`);
    return a;
  };

  const call = async (step, label, signer, to, abi, fn, args) => {
    if (state.done(step)) { console.log(`[${step}] ${label.padEnd(30)} SKIP`); return; }
    if (!send) { console.log(`[${step}] ${label.padEnd(30)} would call ${fn}(${args.map(String).join(', ')})`); return; }
    const c = new ethers.Contract(to, abi, signer);
    const tx = await c[fn](...args);
    const r = await tx.wait();
    state.record(step, { action: fn, label, to, tx: tx.hash, block: r.blockNumber });
    console.log(`[${step}] ${label.padEnd(30)} ${tx.hash}`);
  };

  // ---- 1-4: registry + root, with the controller granted to the admin itself ----
  const ens = await deploy('01-ENSRegistry', 'ENSRegistry', admin, []);
  const root = await deploy('02-Root', 'Root', admin, [ens]);
  await call('03-registry.setOwner(root)', 'registry.setOwner -> Root', admin, ens,
    ['function setOwner(bytes32,address)'], 'setOwner', [ethers.ZeroHash, root]);
  // F6: Root.lock is onlyOwner but setSubnodeOwner is onlyController. Granting a
  // throwaway here and forgetting to revoke it is exactly how testnet left the
  // retired governance EOA able to reassign the whole TLD.
  await call('04-root.setController(admin)', 'root.setController(admin)', admin, root,
    ['function setController(address,bool)'], 'setController', [admin.address, true]);

  // ---- 5-9: reverse registrars ----
  const revReg = await deploy('05-ReverseRegistrar', 'ReverseRegistrar', admin, [ens]);
  const defRevReg = await deploy('06-DefaultReverseRegistrar', 'DefaultReverseRegistrar', admin, []);
  await deploy('07-DefaultReverseResolver', 'DefaultReverseResolver', admin, [defRevReg]);
  await call('08-root.setSubnodeOwner(reverse)', 'root.setSubnodeOwner(reverse)', admin, root,
    ['function setSubnodeOwner(bytes32,address)'], 'setSubnodeOwner', [LABELHASH_REVERSE, admin.address]);
  await call('09-registry.setSubnodeOwner(addr.reverse)', 'registry addr.reverse', admin, ens,
    ['function setSubnodeOwner(bytes32,bytes32,address)'], 'setSubnodeOwner',
    [NAMEHASH_REVERSE, LABELHASH_ADDR, revReg]);

  // ---- 10-13: base registrar owns .vinu ----
  const baseReg = await deploy('10-BaseRegistrar', 'BaseRegistrarImplementation', admin, [ens, NAMEHASH_VINU]);
  await call('11-root.setSubnodeOwner(vinu)', 'root.setSubnodeOwner(vinu)', admin, root,
    ['function setSubnodeOwner(bytes32,address)'], 'setSubnodeOwner', [LABELHASH_VINU, baseReg]);
  const ownedResolver = await deploy('12-OwnedResolver', 'OwnedResolver', admin, []);
  await call('13-baseRegistrar.setResolver', 'baseRegistrar.setResolver', admin, baseReg,
    ['function setResolver(address)'], 'setResolver', [ownedResolver]);

  // ---- 14-15: oracle stack, owned by the UPDATER only for the push oracle ----
  const usdOracle = await deploy('14-VinuUsdOracle', 'VinuUsdOracle', updater,
    [initialAnswer, 'coingecko', PARAMS.oracleMaxAge, PARAMS.oracleMinAnswer,
     PARAMS.oracleMaxAnswer, PARAMS.oracleMaxChangeBps]);
  // Deployed by ADMIN, not the updater: testnet gave this to the unattended CI
  // key, which let a cron key rewrite the entire rent curve via setRentPrices.
  const priceOracle = await deploy('15-ExponentialPremiumPriceOracle', 'ExponentialPremiumPriceOracle', admin,
    [usdOracle, PARAMS.rentPrices, PARAMS.startPremium, PARAMS.premiumDays]);

  // ---- 16-23: wrapper + controller, then authorise ----
  const metadata = await deploy('16-StaticMetadataService', 'StaticMetadataService', admin, [metadataUri]);
  const wrapper = await deploy('17-NameWrapper', 'NameWrapper', admin, [ens, baseReg, metadata]);
  await call('18-baseRegistrar.addController(wrapper)', 'baseReg.addController(wrapper)', admin, baseReg,
    ['function addController(address)'], 'addController', [wrapper]);
  const controller = await deploy('19-ETHRegistrarController', 'ETHRegistrarController', admin,
    [baseReg, priceOracle, PARAMS.minCommitmentAge, PARAMS.maxCommitmentAge, revReg, defRevReg, ens]);
  await call('20-baseRegistrar.addController(controller)', 'baseReg.addController(ctrl)', admin, baseReg,
    ['function addController(address)'], 'addController', [controller]);
  await call('21-nameWrapper.setController', 'wrapper.setController(ctrl)', admin, wrapper,
    ['function setController(address,bool)'], 'setController', [controller, true]);
  await call('22-reverseRegistrar.setController', 'revReg.setController(ctrl)', admin, revReg,
    ['function setController(address,bool)'], 'setController', [controller, true]);
  await call('23-defaultReverseRegistrar.setController', 'defRevReg.setController(ctrl)', admin, defRevReg,
    ['function setController(address,bool)'], 'setController', [controller, true]);

  // ---- 24-26: everything that binds the controller immutably comes AFTER it ----
  await deploy('24-StaticBulkRenewal', 'StaticBulkRenewal', admin, [controller]);
  const publicResolver = await deploy('25-PublicResolver', 'PublicResolver', admin,
    [ens, wrapper, controller, revReg]);
  await call('26-reverseRegistrar.setDefaultResolver', 'revReg.setDefaultResolver', admin, revReg,
    ['function setDefaultResolver(address)'], 'setDefaultResolver', [publicResolver]);

  // ---- 27-28: resolution surface ----
  const gateway = await deploy('27-GatewayProvider', 'GatewayProvider', admin, [admin.address, [gatewayUrl]]);
  await deploy('28-UniversalResolver', 'UniversalResolver', admin, [admin.address, ens, gateway]);

  if (!send) {
    console.log('\nDRY RUN complete — no transactions sent. Re-run with --send.');
    console.log('Root.lock(vinu) is NOT part of this script; it is irreversible (lock-vinu-root.js).');
    return;
  }

  // ---- 29: verify ----
  console.log('\n=== verification ===');
  const reg = new ethers.Contract(ens, ['function owner(bytes32) view returns (address)'], provider);
  const vinuOwner = await reg.owner(NAMEHASH_VINU);
  console.log('registry.owner(vinu)      :', vinuOwner, vinuOwner.toLowerCase() === baseReg.toLowerCase() ? 'OK' : 'MISMATCH');
  const br = new ethers.Contract(baseReg, ['function baseNode() view returns (bytes32)'], provider);
  const baseNode = await br.baseNode();
  console.log('baseRegistrar.baseNode    :', baseNode, baseNode === NAMEHASH_VINU ? 'OK' : 'MISMATCH');
  const ctl = new ethers.Contract(controller,
    ['function paused() view returns (bool)', 'function rentPrice(string,uint256) view returns (tuple(uint256,uint256))'], provider);
  console.log('controller.paused()       :', await ctl.paused());
  try {
    const p = await ctl.rentPrice('bootstrapsmoke', 31536000n);
    console.log('rentPrice(14 chars, 1y)   :', ethers.formatEther(p[0] + p[1]), 'VC');
  } catch (e) { console.log('rentPrice                 : REVERTED —', e.shortMessage || e.message); }

  const rootC = new ethers.Contract(root,
    ['function controllers(address) view returns (bool)', 'function locked(bytes32) view returns (bool)'], provider);
  console.log('root.controllers(admin)   :', await rootC.controllers(admin.address));
  console.log('root.locked(vinu)         :', await rootC.locked(LABELHASH_VINU), '(false is expected — locking is a separate, irreversible decision)');

  console.log(`\nWrote ${state.file}`);
  console.log('NEXT: wire the oracle cron BEFORE 12h elapse, or latestAnswer() reverts StaleAnswer and rentPrice() with it.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
