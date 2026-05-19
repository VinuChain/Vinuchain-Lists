#!/usr/bin/env node
/**
 * lock-vinu-root.js
 *
 * Closes audit finding H-01 (2026-05-19 multi-bot review): the `.vinu` Root is
 * currently NOT locked, so the Root owner EOA can call setSubnodeOwner on the
 * `vinu` label and silently reassign the entire TLD to an attacker-controlled
 * BaseRegistrar. `Root.lock(labelhashVinu)` is irreversible and removes that
 * capability while keeping the existing registrar/controller wiring intact.
 *
 * Defaults to a dry-run (RPC eth_call + gas estimate). To broadcast, pass
 * `--send` AND set LOCK_VINU_CONFIRM=YES in the environment.
 *
 * Required env:
 *   VNS_ORACLE_PRIVATE_KEY   - Root owner key (same EOA per CLAUDE.md gotchas)
 *   VNS_ORACLE_RPC_URL       - default: https://vinufoundation-rpc.com (testnet)
 *   VNS_ORACLE_CHAIN_ID      - default: 206 (testnet)
 *   LOCK_VINU_CONFIRM=YES    - mandatory when passing --send
 */

const fs = require('node:fs');
const path = require('node:path');
const { Contract, JsonRpcProvider, Wallet } = require('ethers');

const RPC_URL =
  process.env.VNS_ORACLE_RPC_URL ||
  process.env.VINUCHAIN_RPC_URL ||
  'https://vinufoundation-rpc.com';
const EXPECTED_CHAIN_ID = Number(process.env.VNS_ORACLE_CHAIN_ID || 206);
const PRIVATE_KEY = process.env.VNS_ORACLE_PRIVATE_KEY;
const SHOULD_SEND = process.argv.includes('--send');
const CONFIRM = process.env.LOCK_VINU_CONFIRM === 'YES';

const DEPLOYMENT_PATH = path.join(
  __dirname,
  '..',
  'contracts',
  'vns',
  `deployment-${EXPECTED_CHAIN_ID === 207 ? 'mainnet' : 'testnet'}.json`,
);

const ROOT_ABI = [
  'function lock(bytes32 label) external',
  'function locked(bytes32 label) view returns (bool)',
  'function owner() view returns (address)',
];

function log(level, msg, extra) {
  const payload = { ts: new Date().toISOString(), level, msg, ...(extra || {}) };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

async function main() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    throw new Error(`deployment file not found: ${DEPLOYMENT_PATH}`);
  }
  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf8'));

  if (deployment.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `deployment chainId ${deployment.chainId} != expected ${EXPECTED_CHAIN_ID}`,
    );
  }
  const rootAddress = deployment.contracts?.Root?.address;
  if (!rootAddress) throw new Error('deployment.contracts.Root.address missing');

  const labelhashVinu = deployment.constants?.labelhashVinu;
  if (!labelhashVinu || labelhashVinu.length !== 66) {
    throw new Error('deployment.constants.labelhashVinu missing or malformed');
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC chainId ${network.chainId} != expected ${EXPECTED_CHAIN_ID}`,
    );
  }

  const readOnly = new Contract(rootAddress, ROOT_ABI, provider);
  const [currentOwner, alreadyLocked] = await Promise.all([
    readOnly.owner(),
    readOnly.locked(labelhashVinu),
  ]);

  log('info', 'context', {
    rootAddress,
    rootOwner: currentOwner,
    labelhashVinu,
    alreadyLocked,
    chainId: EXPECTED_CHAIN_ID,
    rpc: RPC_URL,
  });

  if (alreadyLocked) {
    log('info', 'noop: Root.locked(vinu) is already true — nothing to do');
    return;
  }

  if (!SHOULD_SEND) {
    log('info', 'dry-run: would broadcast Root.lock(labelhashVinu)', {
      hint: 'pass --send AND set LOCK_VINU_CONFIRM=YES to broadcast',
    });
    if (!PRIVATE_KEY) return;
    const signer = new Wallet(PRIVATE_KEY, provider);
    if (
      signer.address.toLowerCase() !== String(currentOwner).toLowerCase()
    ) {
      log('warn', 'signer != Root.owner() — broadcast would revert', {
        signer: signer.address,
        owner: currentOwner,
      });
      return;
    }
    const writable = new Contract(rootAddress, ROOT_ABI, signer);
    const gas = await writable.lock.estimateGas(labelhashVinu);
    log('info', 'gas estimate', { gas: gas.toString() });
    return;
  }

  if (!CONFIRM) {
    throw new Error(
      'refusing to broadcast without LOCK_VINU_CONFIRM=YES in env',
    );
  }
  if (!PRIVATE_KEY) {
    throw new Error('VNS_ORACLE_PRIVATE_KEY required to broadcast');
  }
  const signer = new Wallet(PRIVATE_KEY, provider);
  if (signer.address.toLowerCase() !== String(currentOwner).toLowerCase()) {
    throw new Error(
      `signer ${signer.address} != Root.owner() ${currentOwner}`,
    );
  }
  const writable = new Contract(rootAddress, ROOT_ABI, signer);

  log('warn', 'BROADCASTING Root.lock(labelhashVinu) — IRREVERSIBLE');
  const tx = await writable.lock(labelhashVinu);
  log('info', 'broadcast', { hash: tx.hash });
  const receipt = await tx.wait();
  log('info', 'mined', { block: receipt.blockNumber, status: receipt.status });

  const postLocked = await readOnly.locked(labelhashVinu);
  if (!postLocked) throw new Error('post-state: Root.locked(vinu) still false');
  log('info', 'success: Root.locked(vinu) = true');
}

main().catch((err) => {
  log('error', err.message, { stack: err.stack });
  process.exit(1);
});
