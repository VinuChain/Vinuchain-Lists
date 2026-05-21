#!/usr/bin/env node
/**
 * transfer-vns-ownership.js
 *
 * Helper for closing audit finding H-02 (2026-05-19 multi-bot review): the
 * deployer EOA `0xf9c82B…f347` currently owns every VNS contract. Splitting
 * ownership across role-scoped EOAs requires per-contract transferOwnership
 * txs.
 *
 * !!! CRITICAL WARNING !!!
 * None of the VNS contracts use OpenZeppelin Ownable2Step. transferOwnership
 * is ONE-STEP and irreversible. A typo in NEW_OWNER permanently bricks the
 * contract. The script forces an interactive "I UNDERSTAND ONE-STEP TRANSFER"
 * confirmation before broadcasting.
 *
 * Defaults to dry-run. Pass `--send` to broadcast. Reads NEW_OWNER from env or
 * `--new-owner=0x...` CLI flag. Expects EXPECTED_CURRENT_OWNER to match;
 * otherwise the per-contract step is skipped with a warning.
 *
 * Required env:
 *   VNS_ORACLE_PRIVATE_KEY     - current owner key
 *   NEW_OWNER (or --new-owner) - destination EOA (must be a 20-byte hex, non-zero)
 *   VNS_ORACLE_RPC_URL         - default: https://vinufoundation-rpc.com
 *   VNS_ORACLE_CHAIN_ID        - default: 206
 *   EXPECTED_CURRENT_OWNER     - default: 0xf9c82B1117e8BeA97843042521B8FBC93044f347
 *   TRANSFER_CONFIRM           - must equal "I UNDERSTAND ONE-STEP TRANSFER" when --send
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { Contract, JsonRpcProvider, Wallet, isAddress, ZeroAddress } = require('ethers');

const RPC_URL =
  process.env.VNS_ORACLE_RPC_URL ||
  process.env.VINUCHAIN_RPC_URL ||
  'https://vinufoundation-rpc.com';
const EXPECTED_CHAIN_ID = Number(process.env.VNS_ORACLE_CHAIN_ID || 206);
const PRIVATE_KEY = process.env.VNS_ORACLE_PRIVATE_KEY;
const EXPECTED_CURRENT_OWNER = (
  process.env.EXPECTED_CURRENT_OWNER ||
  '0xf9c82B1117e8BeA97843042521B8FBC93044f347'
).toLowerCase();
const SHOULD_SEND = process.argv.includes('--send');
const CONFIRM_PHRASE = 'I UNDERSTAND ONE-STEP TRANSFER';

const NEW_OWNER = (() => {
  const flag = process.argv.find((a) => a.startsWith('--new-owner='));
  if (flag) return flag.slice('--new-owner='.length);
  return process.env.NEW_OWNER;
})();

// Optional comma-separated subset of TARGETS to transfer. Operators use
// this when splitting ownership across role-scoped EOAs in multiple runs
// (e.g. `--targets=VinuUsdOracle,ExponentialPremiumPriceOracle` for the
// oracle-updater role, then another run for the namespace-admin role).
// When unset the script transfers EVERY contract in TARGETS to NEW_OWNER.
const TARGETS_FILTER = (() => {
  const flag = process.argv.find((a) => a.startsWith('--targets='));
  if (flag) return flag.slice('--targets='.length).split(',').map((s) => s.trim()).filter(Boolean);
  if (process.env.TARGETS) return process.env.TARGETS.split(',').map((s) => s.trim()).filter(Boolean);
  return null;
})();

const DEPLOYMENT_PATH = path.join(
  __dirname,
  '..',
  'contracts',
  'vns',
  `deployment-${EXPECTED_CHAIN_ID === 207 ? 'mainnet' : 'testnet'}.json`,
);

// VNS contracts that expose `owner() / transferOwnership()`. We deliberately
// skip Legacy*/Previous* / ENSRegistry (no owner) / *Resolver siblings
// (singleton/no owner) / UniversalResolver / StaticMetadataService.
const TARGETS = [
  'Root',
  'BaseRegistrarImplementation',
  'VNSBaseRegistrar',
  'NameWrapper',
  'OwnedResolver',
  'GatewayProvider',
  'ETHRegistrarController',
  'VNSRegistrarController',
  'StaticBulkRenewal',
  'VNSBulkRenewal',
  'ReverseRegistrar',
  'DefaultReverseRegistrar',
  'ExponentialPremiumPriceOracle',
  'VinuUsdOracle',
];

const OWNABLE_ABI = [
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner) external',
];

const ANSI = {
  red: '[31m',
  yellow: '[33m',
  reset: '[0m',
  bold: '[1m',
};

function log(level, msg, extra) {
  const payload = { ts: new Date().toISOString(), level, msg, ...(extra || {}) };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function bigBanner() {
  process.stderr.write(
    `\n${ANSI.bold}${ANSI.red}` +
      '!!! ONE-STEP TRANSFER WARNING !!!\n' +
      'None of the VNS contracts use Ownable2Step.\n' +
      'transferOwnership is IRREVERSIBLE. A typo in NEW_OWNER bricks the contract.\n' +
      `${ANSI.reset}\n`,
  );
}

async function confirmInteractive() {
  if (process.env.TRANSFER_CONFIRM === CONFIRM_PHRASE) return true;
  if (!input.isTTY) {
    throw new Error(
      `non-interactive shell: set TRANSFER_CONFIRM="${CONFIRM_PHRASE}" to proceed`,
    );
  }
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `Type exactly "${CONFIRM_PHRASE}" to proceed: `,
  );
  rl.close();
  return answer.trim() === CONFIRM_PHRASE;
}

async function main() {
  if (!NEW_OWNER || !isAddress(NEW_OWNER) || NEW_OWNER === ZeroAddress) {
    throw new Error(
      'NEW_OWNER must be a valid non-zero 20-byte address (--new-owner=0x... or NEW_OWNER env)',
    );
  }

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

  if (SHOULD_SEND) {
    bigBanner();
    const ok = await confirmInteractive();
    if (!ok) throw new Error('confirmation phrase mismatch — aborting');
  }

  const signer = SHOULD_SEND && PRIVATE_KEY ? new Wallet(PRIVATE_KEY, provider) : null;

  log('info', 'context', {
    chainId: EXPECTED_CHAIN_ID,
    rpc: RPC_URL,
    expectedCurrentOwner: EXPECTED_CURRENT_OWNER,
    newOwner: NEW_OWNER,
    mode: SHOULD_SEND ? 'broadcast' : 'dry-run',
    signer: signer?.address,
  });

  const effectiveTargets = TARGETS_FILTER
    ? TARGETS_FILTER.filter((t) => {
        if (!TARGETS.includes(t)) {
          log('warn', `--targets filter mentions unknown contract; skipping`, { name: t });
          return false;
        }
        return true;
      })
    : TARGETS;
  if (effectiveTargets.length === 0) {
    throw new Error('no targets selected after applying --targets filter');
  }
  log('info', 'effective targets', { count: effectiveTargets.length, names: effectiveTargets });

  const results = [];
  for (const name of effectiveTargets) {
    const entry = deployment.contracts?.[name];
    if (!entry?.address) {
      results.push({ name, status: 'skip:not-deployed' });
      continue;
    }
    const address = entry.address;
    const readOnly = new Contract(address, OWNABLE_ABI, provider);
    let currentOwner;
    try {
      currentOwner = (await readOnly.owner()).toLowerCase();
    } catch (err) {
      results.push({ name, address, status: 'skip:no-owner-fn', err: err.message });
      continue;
    }
    if (currentOwner === NEW_OWNER.toLowerCase()) {
      results.push({ name, address, status: 'skip:already-owned' });
      continue;
    }
    if (currentOwner !== EXPECTED_CURRENT_OWNER) {
      results.push({
        name,
        address,
        status: 'skip:owner-mismatch',
        currentOwner,
        expected: EXPECTED_CURRENT_OWNER,
      });
      continue;
    }

    if (!SHOULD_SEND) {
      try {
        const gas = await readOnly.transferOwnership.estimateGas?.(NEW_OWNER);
        results.push({
          name,
          address,
          status: 'dry-run:ok',
          gas: gas?.toString(),
        });
      } catch (err) {
        results.push({ name, address, status: 'dry-run:estimate-failed', err: err.message });
      }
      continue;
    }

    try {
      const writable = new Contract(address, OWNABLE_ABI, signer);
      const tx = await writable.transferOwnership(NEW_OWNER);
      log('info', `submitted ${name}`, { address, hash: tx.hash });
      const rcpt = await tx.wait();
      const postOwner = (await readOnly.owner()).toLowerCase();
      if (postOwner !== NEW_OWNER.toLowerCase()) {
        results.push({
          name,
          address,
          status: 'fail:post-owner-mismatch',
          postOwner,
        });
        continue;
      }
      results.push({
        name,
        address,
        status: 'ok',
        hash: tx.hash,
        block: rcpt.blockNumber,
      });
    } catch (err) {
      results.push({ name, address, status: 'fail:tx', err: err.message });
    }
  }

  log('info', 'results', { results });
  const failed = results.filter((r) => r.status.startsWith('fail:'));
  if (failed.length > 0) {
    process.stderr.write(
      `${ANSI.red}${failed.length} contract(s) failed transfer — review JSON output${ANSI.reset}\n`,
    );
    process.exit(2);
  }
}

main().catch((err) => {
  log('error', err.message, { stack: err.stack });
  process.exit(1);
});
