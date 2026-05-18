#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
} = require('ethers');
const {
  assertChain,
  resolveVnsOraclePrice,
  toOracleAnswer,
} = require('./update-vns-oracle');

const DEPLOYMENT_PATH = path.join(__dirname, '../contracts/vns/deployment-testnet.json');
const INFO_PATH = path.join(__dirname, '../contracts/vns/info.json');
const EXPECTED_CHAIN_ID = Number(process.env.VNS_ORACLE_CHAIN_ID || 206);
const RPC_URL =
  process.env.VNS_ORACLE_RPC_URL ||
  process.env.VINUCHAIN_RPC_URL ||
  'https://vinufoundation-rpc.com';
const PRIVATE_KEY =
  process.env.VNS_DEPLOYER_PRIVATE_KEY ||
  process.env.VNS_ORACLE_PRIVATE_KEY ||
  process.env.PRIVATE_TEST;
const SHOULD_SEND = process.argv.includes('--send');
const SHOULD_KEEP_OLD_CONTROLLER = process.argv.includes('--keep-old-controller');

const ARTIFACTS = {
  VinuUsdOracle:
    'contracts/vns/source/artifacts/contracts/ethregistrar/VinuUsdOracle.sol/VinuUsdOracle.json',
  ExponentialPremiumPriceOracle:
    'contracts/vns/source/artifacts/contracts/ethregistrar/ExponentialPremiumPriceOracle.sol/ExponentialPremiumPriceOracle.json',
  ETHRegistrarController:
    'contracts/vns/source/artifacts/contracts/ethregistrar/ETHRegistrarController.sol/ETHRegistrarController.json',
  StaticBulkRenewal:
    'contracts/vns/source/artifacts/contracts/ethregistrar/StaticBulkRenewal.sol/StaticBulkRenewal.json',
};

const ABIS = {
  Ownable: ['function owner() view returns (address)'],
  BaseRegistrar: [
    'function owner() view returns (address)',
    'function controllers(address controller) view returns (bool)',
    'function addController(address controller) external',
    'function removeController(address controller) external',
  ],
  Controllable: [
    'function owner() view returns (address)',
    'function controllers(address controller) view returns (bool)',
    'function setController(address controller, bool active) external',
  ],
  Controller: [
    'function prices() view returns (address)',
    'function minCommitmentAge() view returns (uint256)',
    'function maxCommitmentAge() view returns (uint256)',
    'function rentPrice(string label, uint256 duration) view returns (tuple(uint256 base, uint256 premium))',
    'function available(string label) view returns (bool)',
  ],
  PriceOracle: [
    'function usdOracle() view returns (address)',
    'function price1Letter() view returns (uint256)',
    'function price2Letter() view returns (uint256)',
    'function price3Letter() view returns (uint256)',
    'function price4Letter() view returns (uint256)',
    'function price5Letter() view returns (uint256)',
  ],
  VinuUsdOracle: [
    'function latestAnswer() view returns (int256)',
    'function latestStoredAnswer() view returns (int256)',
    'function maxAge() view returns (uint256)',
    'function maxAnswer() view returns (uint256)',
    'function maxChangeBps() view returns (uint256)',
    'function minAnswer() view returns (uint256)',
    'function owner() view returns (address)',
    'function source() view returns (string)',
    'function updatedAt() view returns (uint256)',
  ],
};

const RENT_PRICES = [
  0n,
  0n,
  20294266869609n,
  5073566717402n,
  158548959919n,
];
const START_PREMIUM = 100000000000000000000000000n;
const PREMIUM_DAYS = 21n;
const MIN_COMMITMENT_AGE = 60n;
const MAX_COMMITMENT_AGE = 86400n;
const ORACLE_MAX_AGE = BigInt(process.env.VNS_ORACLE_MAX_AGE_SECONDS || 24 * 60 * 60);
const MIN_ORACLE_ANSWER = BigInt(process.env.VNS_ORACLE_MIN_ANSWER || 1000);
const MAX_ORACLE_ANSWER = BigInt(process.env.VNS_ORACLE_MAX_ANSWER || 1000000);
const MAX_ORACLE_CHANGE_BPS = BigInt(
  process.env.VNS_ORACLE_MAX_CHANGE_BPS || 2000,
);
const ONE_YEAR = 365n * 24n * 60n * 60n;
const DRY_RUN_ADDRESS = '0x0000000000000000000000000000000000000001';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function artifact(name) {
  return readJson(path.join(__dirname, '..', ARTIFACTS[name]));
}

function factory(name, signer) {
  const contractArtifact = artifact(name);
  return new ContractFactory(
    contractArtifact.abi,
    contractArtifact.bytecode,
    signer,
  );
}

function contractRecord(address, transactionHash, blockNumber) {
  return { address, transactionHash, blockNumber };
}

function archiveContract(contracts, currentKey, legacyKey) {
  if (contracts[currentKey] && !contracts[legacyKey]) {
    contracts[legacyKey] = contracts[currentKey];
  }
}

function upsertInfoContract(info, name, patch) {
  const index = info.contracts.findIndex((contract) => contract.name === name);
  const next = { name, ...patch };
  if (index === -1) {
    info.contracts.push(next);
  } else {
    info.contracts[index] = { ...info.contracts[index], ...patch };
  }
}

function renameInfoContract(info, from, to, patch) {
  const index = info.contracts.findIndex((contract) => contract.name === from);
  if (index !== -1) {
    info.contracts[index] = {
      ...info.contracts[index],
      name: to,
      ...patch,
    };
  } else {
    upsertInfoContract(info, to, patch);
  }
}

async function deploy(name, args, signer) {
  const deployFactory = factory(name, signer);
  if (!SHOULD_SEND) {
    const tx = await deployFactory.getDeployTransaction(...args);
    return {
      name,
      args: args.map((arg) => (Array.isArray(arg) ? arg.map(String) : String(arg))),
      bytecodeBytes: Math.floor((tx.data.length - 2) / 2),
    };
  }

  const contract = await deployFactory.deploy(...args);
  const deploymentTransaction = contract.deploymentTransaction();
  console.log(`${name}: submitted ${deploymentTransaction.hash}`);
  await contract.waitForDeployment();
  const receipt = await deploymentTransaction.wait();
  const address = await contract.getAddress();
  console.log(`${name}: deployed ${address}`);
  return {
    address,
    transactionHash: deploymentTransaction.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function send(label, txPromise) {
  const tx = await txPromise;
  console.log(`${label}: submitted ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`${label}: confirmed in block ${receipt.blockNumber}`);
  return { hash: tx.hash, blockNumber: receipt.blockNumber };
}

async function assertOwned(contract, expectedOwner, label) {
  const owner = await contract.owner();
  if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(`${label} owner is ${owner}; expected ${expectedOwner}`);
  }
}

async function main() {
  const deployment = readJson(DEPLOYMENT_PATH);
  const info = readJson(INFO_PATH);
  const provider = new JsonRpcProvider(RPC_URL);
  const targetChainId = await assertChain(provider, EXPECTED_CHAIN_ID, 'target oracle');
  const price = await resolveVnsOraclePrice();
  const answer = toOracleAnswer(price.usd);
  const mode = SHOULD_SEND ? 'send' : 'dry-run';

  if (
    deployment.contracts.VinuUsdOracle &&
    deployment.contracts.LegacyVNSRegistrarController &&
    !process.argv.includes('--force')
  ) {
    throw new Error(
      'deployment-testnet.json already records a switched VNS oracle stack; pass --force to redeploy',
    );
  }

  if (!PRIVATE_KEY && SHOULD_SEND) {
    throw new Error('Set VNS_DEPLOYER_PRIVATE_KEY, VNS_ORACLE_PRIVATE_KEY, or PRIVATE_TEST');
  }

  const signer = PRIVATE_KEY ? new Wallet(PRIVATE_KEY, provider) : Wallet.createRandom();
  const deployer = await signer.getAddress();
  const balance = PRIVATE_KEY ? await provider.getBalance(deployer) : 0n;

  const oldController = deployment.contracts.VNSRegistrarController.address;
  const baseRegistrar = deployment.contracts.VNSBaseRegistrar.address;
  const nameWrapper = deployment.contracts.NameWrapper.address;
  const reverseRegistrar = deployment.contracts.ReverseRegistrar.address;
  const defaultReverseRegistrar = deployment.contracts.DefaultReverseRegistrar.address;
  const registry = deployment.contracts.VNSRegistry.address;

  const base = new Contract(baseRegistrar, ABIS.BaseRegistrar, signer);
  const wrapper = new Contract(nameWrapper, ABIS.Controllable, signer);
  const reverse = new Contract(reverseRegistrar, ABIS.Controllable, signer);
  const defaultReverse = new Contract(defaultReverseRegistrar, ABIS.Controllable, signer);

  await Promise.all([
    assertOwned(base, deployer, 'VNS base registrar'),
    assertOwned(wrapper, deployer, 'NameWrapper'),
    assertOwned(reverse, deployer, 'ReverseRegistrar'),
    assertOwned(defaultReverse, deployer, 'DefaultReverseRegistrar'),
  ]);

  console.log(
    JSON.stringify(
      {
        mode,
        deployer,
        deployerBalance: PRIVATE_KEY ? `${formatEther(balance)} VC` : null,
        targetChainId,
        vcUsd: price.usd,
        source: price.source,
        oracleAnswer: answer.toString(),
        revokeOldController: !SHOULD_KEEP_OLD_CONTROLLER,
      },
      null,
      2,
    ),
  );

  const oracleDeployment = await deploy(
    'VinuUsdOracle',
    [
      answer,
      price.source,
      ORACLE_MAX_AGE,
      MIN_ORACLE_ANSWER,
      MAX_ORACLE_ANSWER,
      MAX_ORACLE_CHANGE_BPS,
    ],
    signer,
  );
  if (!SHOULD_SEND) {
    const priceOraclePlan = await deploy(
      'ExponentialPremiumPriceOracle',
      [DRY_RUN_ADDRESS, RENT_PRICES, START_PREMIUM, PREMIUM_DAYS],
      signer,
    );
    const controllerPlan = await deploy(
      'ETHRegistrarController',
      [
        baseRegistrar,
        DRY_RUN_ADDRESS,
        MIN_COMMITMENT_AGE,
        MAX_COMMITMENT_AGE,
        reverseRegistrar,
        defaultReverseRegistrar,
        registry,
      ],
      signer,
    );
    const bulkPlan = await deploy(
      'StaticBulkRenewal',
      [DRY_RUN_ADDRESS],
      signer,
    );
    console.log(JSON.stringify({ oracleDeployment, priceOraclePlan, controllerPlan, bulkPlan }, null, 2));
    return;
  }

  const priceOracleDeployment = await deploy(
    'ExponentialPremiumPriceOracle',
    [
      oracleDeployment.address,
      RENT_PRICES,
      START_PREMIUM,
      PREMIUM_DAYS,
    ],
    signer,
  );
  const controllerDeployment = await deploy(
    'ETHRegistrarController',
    [
      baseRegistrar,
      priceOracleDeployment.address,
      MIN_COMMITMENT_AGE,
      MAX_COMMITMENT_AGE,
      reverseRegistrar,
      defaultReverseRegistrar,
      registry,
    ],
    signer,
  );
  const bulkDeployment = await deploy(
    'StaticBulkRenewal',
    [controllerDeployment.address],
    signer,
  );

  const permissionTransactions = {};
  const newController = controllerDeployment.address;

  if (!(await base.controllers(newController))) {
    permissionTransactions['baseRegistrar.addController(newController)'] = await send(
      'baseRegistrar.addController(newController)',
      base.addController(newController),
    );
  }
  if (!(await wrapper.controllers(newController))) {
    permissionTransactions['nameWrapper.setController(newController)'] = await send(
      'nameWrapper.setController(newController)',
      wrapper.setController(newController, true),
    );
  }
  if (!(await reverse.controllers(newController))) {
    permissionTransactions['reverseRegistrar.setController(newController)'] = await send(
      'reverseRegistrar.setController(newController)',
      reverse.setController(newController, true),
    );
  }
  if (!(await defaultReverse.controllers(newController))) {
    permissionTransactions['defaultReverseRegistrar.setController(newController)'] = await send(
      'defaultReverseRegistrar.setController(newController)',
      defaultReverse.setController(newController, true),
    );
  }

  if (!SHOULD_KEEP_OLD_CONTROLLER) {
    if (await base.controllers(oldController)) {
      permissionTransactions['baseRegistrar.removeController(oldController)'] = await send(
        'baseRegistrar.removeController(oldController)',
        base.removeController(oldController),
      );
    }
    if (await wrapper.controllers(oldController)) {
      permissionTransactions['nameWrapper.removeController(oldController)'] = await send(
        'nameWrapper.removeController(oldController)',
        wrapper.setController(oldController, false),
      );
    }
    if (await reverse.controllers(oldController)) {
      permissionTransactions['reverseRegistrar.removeController(oldController)'] = await send(
        'reverseRegistrar.removeController(oldController)',
        reverse.setController(oldController, false),
      );
    }
    if (await defaultReverse.controllers(oldController)) {
      permissionTransactions['defaultReverseRegistrar.removeController(oldController)'] = await send(
        'defaultReverseRegistrar.removeController(oldController)',
        defaultReverse.setController(oldController, false),
      );
    }
  }

  const [oracleRead, priceOracleRead, controllerRead, renewalQuote] = await Promise.all([
    (async () => {
      const oracle = new Contract(oracleDeployment.address, ABIS.VinuUsdOracle, provider);
      return {
        latestAnswer: (await oracle.latestAnswer()).toString(),
        latestStoredAnswer: (await oracle.latestStoredAnswer()).toString(),
        maxAge: (await oracle.maxAge()).toString(),
        minAnswer: (await oracle.minAnswer()).toString(),
        maxAnswer: (await oracle.maxAnswer()).toString(),
        maxChangeBps: (await oracle.maxChangeBps()).toString(),
        owner: await oracle.owner(),
        source: await oracle.source(),
        updatedAt: (await oracle.updatedAt()).toString(),
      };
    })(),
    (async () => {
      const oracle = new Contract(priceOracleDeployment.address, ABIS.PriceOracle, provider);
      return {
        usdOracle: await oracle.usdOracle(),
        price1Letter: (await oracle.price1Letter()).toString(),
        price2Letter: (await oracle.price2Letter()).toString(),
        price3Letter: (await oracle.price3Letter()).toString(),
        price4Letter: (await oracle.price4Letter()).toString(),
        price5Letter: (await oracle.price5Letter()).toString(),
      };
    })(),
    (async () => {
      const controller = new Contract(controllerDeployment.address, ABIS.Controller, provider);
      return {
        prices: await controller.prices(),
        minCommitmentAge: (await controller.minCommitmentAge()).toString(),
        maxCommitmentAge: (await controller.maxCommitmentAge()).toString(),
        nameAvailable: await controller.available('name'),
      };
    })(),
    (async () => {
      const controller = new Contract(controllerDeployment.address, ABIS.Controller, provider);
      const priceQuote = await controller.rentPrice('name', ONE_YEAR);
      return {
        label: 'name',
        duration: ONE_YEAR.toString(),
        base: priceQuote.base.toString(),
        premium: priceQuote.premium.toString(),
      };
    })(),
  ]);

  if (oracleRead.latestAnswer !== answer.toString()) {
    throw new Error('VinuUsdOracle answer verification failed');
  }
  if (priceOracleRead.usdOracle.toLowerCase() !== oracleDeployment.address.toLowerCase()) {
    throw new Error('Price oracle is not wired to VinuUsdOracle');
  }
  if (controllerRead.prices.toLowerCase() !== priceOracleDeployment.address.toLowerCase()) {
    throw new Error('Registrar controller is not wired to new price oracle');
  }

  const contracts = deployment.contracts;
  archiveContract(contracts, 'DummyOracle', 'LegacyDummyOracle');
  archiveContract(contracts, 'ExponentialPremiumPriceOracle', 'LegacyExponentialPremiumPriceOracle');
  archiveContract(contracts, 'ETHRegistrarController', 'LegacyETHRegistrarController');
  archiveContract(contracts, 'VNSRegistrarController', 'LegacyVNSRegistrarController');
  archiveContract(contracts, 'StaticBulkRenewal', 'LegacyStaticBulkRenewal');
  archiveContract(contracts, 'VNSBulkRenewal', 'LegacyVNSBulkRenewal');

  contracts.VinuUsdOracle = contractRecord(
    oracleDeployment.address,
    oracleDeployment.transactionHash,
    oracleDeployment.blockNumber,
  );
  contracts.ExponentialPremiumPriceOracle = contractRecord(
    priceOracleDeployment.address,
    priceOracleDeployment.transactionHash,
    priceOracleDeployment.blockNumber,
  );
  contracts.ETHRegistrarController = contractRecord(
    controllerDeployment.address,
    controllerDeployment.transactionHash,
    controllerDeployment.blockNumber,
  );
  contracts.VNSRegistrarController = contractRecord(
    controllerDeployment.address,
    controllerDeployment.transactionHash,
    controllerDeployment.blockNumber,
  );
  contracts.StaticBulkRenewal = contractRecord(
    bulkDeployment.address,
    bulkDeployment.transactionHash,
    bulkDeployment.blockNumber,
  );
  contracts.VNSBulkRenewal = contractRecord(
    bulkDeployment.address,
    bulkDeployment.transactionHash,
    bulkDeployment.blockNumber,
  );

  const transactions = deployment.transactions || {};
  transactions['vnsOracleStack.deploy.VinuUsdOracle'] = {
    hash: oracleDeployment.transactionHash,
    blockNumber: oracleDeployment.blockNumber,
  };
  transactions['vnsOracleStack.deploy.ExponentialPremiumPriceOracle'] = {
    hash: priceOracleDeployment.transactionHash,
    blockNumber: priceOracleDeployment.blockNumber,
  };
  transactions['vnsOracleStack.deploy.ETHRegistrarController'] = {
    hash: controllerDeployment.transactionHash,
    blockNumber: controllerDeployment.blockNumber,
  };
  transactions['vnsOracleStack.deploy.StaticBulkRenewal'] = {
    hash: bulkDeployment.transactionHash,
    blockNumber: bulkDeployment.blockNumber,
  };
  Object.assign(transactions, permissionTransactions);
  deployment.transactions = transactions;

  deployment.oracleStack = {
    switchedAt: new Date().toISOString(),
    source: price.source,
    vcUsd: price.usd,
    oracleAnswer: answer.toString(),
    oracleDecimals: 8,
    oracleMaxAgeSeconds: ORACLE_MAX_AGE.toString(),
    minOracleAnswer: MIN_ORACLE_ANSWER.toString(),
    maxOracleAnswer: MAX_ORACLE_ANSWER.toString(),
    maxOracleChangeBps: MAX_ORACLE_CHANGE_BPS.toString(),
    rentPrices: RENT_PRICES.map(String),
    startPremium: START_PREMIUM.toString(),
    premiumDays: PREMIUM_DAYS.toString(),
    minCommitmentAge: MIN_COMMITMENT_AGE.toString(),
    maxCommitmentAge: MAX_COMMITMENT_AGE.toString(),
    oldUsdOracle: contracts.LegacyDummyOracle.address,
    newUsdOracle: oracleDeployment.address,
    oldPriceOracle: contracts.LegacyExponentialPremiumPriceOracle.address,
    newPriceOracle: priceOracleDeployment.address,
    oldController,
    newController,
    oldControllerRevoked: !SHOULD_KEEP_OLD_CONTROLLER,
    verification: {
      oracle: oracleRead,
      priceOracle: priceOracleRead,
      controller: controllerRead,
      renewalQuote,
    },
  };

  if (deployment.smoke) {
    deployment.smoke.controller = controllerDeployment.address;
    deployment.smoke.priceWei = renewalQuote.base;
  }

  renameInfoContract(info, 'DummyOracle', 'LegacyDummyOracle', {
    artifact: 'DummyOracle',
    address: contracts.LegacyDummyOracle.address,
    type: 'oracle',
    description:
      'Legacy static USD price oracle retained for provenance; no longer used by the active VNS registrar controller.',
  });
  upsertInfoContract(info, 'VinuUsdOracle', {
    address: oracleDeployment.address,
    type: 'oracle',
    description:
      'Owner-updated VC/USD oracle used by the active VNS price oracle. Updates are sourced from CoinGecko first and guarded VinuSwap V3 TWAP fallback pricing.',
  });
  upsertInfoContract(info, 'LegacyExponentialPremiumPriceOracle', {
    artifact: 'ExponentialPremiumPriceOracle',
    address: contracts.LegacyExponentialPremiumPriceOracle.address,
    type: 'oracle',
    description:
      'Legacy VNS premium price oracle that read the static DummyOracle before the real oracle-stack switch.',
  });
  upsertInfoContract(info, 'ExponentialPremiumPriceOracle', {
    address: priceOracleDeployment.address,
    type: 'oracle',
    description:
      'Active ENS exponential premium price oracle for VNS testnet registrations, wired to VinuUsdOracle.',
  });
  upsertInfoContract(info, 'LegacyVNSRegistrarController', {
    artifact: 'ETHRegistrarController',
    address: contracts.LegacyVNSRegistrarController.address,
    type: 'controller',
    description:
      'Legacy VNS registrar controller retained for provenance after controller permissions were moved to the real oracle stack.',
  });
  upsertInfoContract(info, 'VNSRegistrarController', {
    artifact: 'ETHRegistrarController',
    address: controllerDeployment.address,
    type: 'controller',
    description:
      'Active patched ENS registrar controller that registers .vinu names, reads the real VinuUsdOracle-backed price oracle, and writes VNS reverse records.',
  });
  upsertInfoContract(info, 'LegacyVNSBulkRenewal', {
    artifact: 'StaticBulkRenewal',
    address: contracts.LegacyVNSBulkRenewal.address,
    type: 'helper',
    description:
      'Legacy bulk renewal helper that targets the pre-switch VNS registrar controller.',
  });
  upsertInfoContract(info, 'VNSBulkRenewal', {
    artifact: 'StaticBulkRenewal',
    address: bulkDeployment.address,
    type: 'helper',
    description:
      'Bulk renewal helper for .vinu names that targets the active real-oracle VNS registrar controller.',
  });

  writeJson(DEPLOYMENT_PATH, deployment);
  writeJson(INFO_PATH, info);

  console.log(
    JSON.stringify(
      {
        deployed: {
          VinuUsdOracle: oracleDeployment.address,
          ExponentialPremiumPriceOracle: priceOracleDeployment.address,
          VNSRegistrarController: controllerDeployment.address,
          VNSBulkRenewal: bulkDeployment.address,
        },
        permissionTransactions,
        verification: deployment.oracleStack.verification,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
