#!/usr/bin/env node
/**
 * deploy-vns-controller-with-pause.js
 *
 * F3: deploys the new ETHRegistrarController with on-chain pause()/unpause()
 * methods, then atomically swaps the controller set on BaseRegistrar,
 * NameWrapper, ReverseRegistrar, and DefaultReverseRegistrar (add new,
 * remove old). The new controller is owned by the namespace admin EOA.
 *
 * Mirrors the controller-swap pattern in deploy-vns-oracle-stack.js but
 * limited to the controller surface only. Reads constructor args from
 * deployment-testnet.json.
 *
 * Required env:
 *   VNS_NAMESPACE_ADMIN_KEY  - signer (current owner of all the surfaces)
 *   VNS_ORACLE_RPC_URL       - default https://vinufoundation-rpc.com
 *   VNS_ORACLE_CHAIN_ID      - default 206
 *
 * Defaults to dry-run. Pass --send to broadcast. Pass --confirm-chain-id=206
 * as a tripwire against running against the wrong network.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
} = require('ethers');

const ARTIFACT_PATH = path.join(
  __dirname,
  '..',
  'contracts',
  'vns',
  'source',
  'artifacts',
  'contracts',
  'ethregistrar',
  'ETHRegistrarController.sol',
  'ETHRegistrarController.json',
);
const DEPLOYMENT_PATH = path.join(
  __dirname,
  '..',
  'contracts',
  'vns',
  'deployment-testnet.json',
);

const RPC_URL =
  process.env.VNS_ORACLE_RPC_URL ||
  process.env.VINUCHAIN_RPC_URL ||
  'https://vinufoundation-rpc.com';
const EXPECTED_CHAIN_ID = Number(process.env.VNS_ORACLE_CHAIN_ID || 206);
const PRIVATE_KEY = process.env.VNS_NAMESPACE_ADMIN_KEY;
const SHOULD_SEND = process.argv.includes('--send');
const CONFIRM_CHAIN_ARG = process.argv.find((a) =>
  a.startsWith('--confirm-chain-id='),
);
const CONFIRMED_CHAIN_ID = CONFIRM_CHAIN_ARG
  ? Number(CONFIRM_CHAIN_ARG.slice('--confirm-chain-id='.length))
  : null;

const CONTROLLABLE_ABI = [
  'function addController(address controller)',
  'function removeController(address controller)',
  'function isController(address) view returns (bool)',
  'function owner() view returns (address)',
];

function log(level, msg, extra) {
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(extra || {}),
    }) + '\n',
  );
}

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('Set VNS_NAMESPACE_ADMIN_KEY (namespace admin EOA)');
  }
  if (SHOULD_SEND && CONFIRMED_CHAIN_ID !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `--confirm-chain-id=${EXPECTED_CHAIN_ID} required with --send (got ${CONFIRMED_CHAIN_ID})`,
    );
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf8'));
  if (deployment.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `deployment chainId ${deployment.chainId} != expected ${EXPECTED_CHAIN_ID}`,
    );
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC chainId ${network.chainId} != expected ${EXPECTED_CHAIN_ID}`,
    );
  }

  const signer = new Wallet(PRIVATE_KEY, provider);
  const signerAddress = await signer.getAddress();
  log('info', 'context', {
    signer: signerAddress,
    chainId: EXPECTED_CHAIN_ID,
    mode: SHOULD_SEND ? 'broadcast' : 'dry-run',
  });

  const baseRegistrar = deployment.contracts.BaseRegistrarImplementation.address;
  const ens = deployment.contracts.ENSRegistry.address;
  const reverseRegistrar = deployment.contracts.ReverseRegistrar.address;
  const defaultReverseRegistrar =
    deployment.contracts.DefaultReverseRegistrar.address;
  const nameWrapper = deployment.contracts.NameWrapper.address;
  const oldController = deployment.contracts.ETHRegistrarController.address;
  const priceOracle = deployment.contracts.ExponentialPremiumPriceOracle.address;
  const minCommitmentAge = BigInt(
    deployment.oracleStack.minCommitmentAge || '60',
  );
  const maxCommitmentAge = BigInt(
    deployment.oracleStack.maxCommitmentAge || '86400',
  );

  log('info', 'constructor args', {
    baseRegistrar,
    priceOracle,
    minCommitmentAge: minCommitmentAge.toString(),
    maxCommitmentAge: maxCommitmentAge.toString(),
    reverseRegistrar,
    defaultReverseRegistrar,
    ens,
  });

  // Verify admin EOA owns the surfaces we need to mutate.
  for (const [name, address] of [
    ['BaseRegistrar', baseRegistrar],
    ['NameWrapper', nameWrapper],
    ['ReverseRegistrar', reverseRegistrar],
    ['DefaultReverseRegistrar', defaultReverseRegistrar],
  ]) {
    const owner = await new Contract(
      address,
      CONTROLLABLE_ABI,
      provider,
    ).owner();
    if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error(
        `${name} owner ${owner} != signer ${signerAddress}; cannot addController/removeController`,
      );
    }
    log('info', `${name} ownership verified`, { owner });
  }

  if (!SHOULD_SEND) {
    log('info', 'dry-run complete; pass --send to broadcast');
    return;
  }

  // Step 1: deploy the new controller.
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const newController = await factory.deploy(
    baseRegistrar,
    priceOracle,
    minCommitmentAge,
    maxCommitmentAge,
    reverseRegistrar,
    defaultReverseRegistrar,
    ens,
  );
  await newController.waitForDeployment();
  const newControllerAddress = await newController.getAddress();
  const deployTx = newController.deploymentTransaction();
  const deployRcpt = await deployTx.wait();
  log('info', 'new controller deployed', {
    address: newControllerAddress,
    txHash: deployTx.hash,
    block: deployRcpt.blockNumber,
  });

  // Step 2: add the new controller on each Controllable surface.
  const swapSurfaces = [
    ['BaseRegistrar', baseRegistrar],
    ['NameWrapper', nameWrapper],
    ['ReverseRegistrar', reverseRegistrar],
    ['DefaultReverseRegistrar', defaultReverseRegistrar],
  ];
  const addTxs = {};
  for (const [name, address] of swapSurfaces) {
    const c = new Contract(address, CONTROLLABLE_ABI, signer);
    const tx = await c.addController(newControllerAddress);
    const rcpt = await tx.wait();
    addTxs[name] = { hash: tx.hash, block: rcpt.blockNumber };
    log('info', `addController ${name}`, addTxs[name]);
  }

  // Step 3: remove the old controller from each Controllable surface.
  const removeTxs = {};
  for (const [name, address] of swapSurfaces) {
    const c = new Contract(address, CONTROLLABLE_ABI, signer);
    const tx = await c.removeController(oldController);
    const rcpt = await tx.wait();
    removeTxs[name] = { hash: tx.hash, block: rcpt.blockNumber };
    log('info', `removeController ${name}`, removeTxs[name]);
  }

  log('info', 'F3 swap complete', {
    newController: newControllerAddress,
    oldController,
    addTxs,
    removeTxs,
  });
}

main().catch((err) => {
  log('error', err.message, { stack: err.stack });
  process.exit(1);
});
