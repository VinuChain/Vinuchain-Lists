#!/usr/bin/env node

/**
 * On-chain validation entry point (addresses AUD-01 technical half).
 *
 * Loads every token and contract entry from the registry and cross-checks each
 * against the live chain it declares via chainId. Run separately from the
 * off-chain validate.js because it needs network egress and is run as its own
 * CI job. Exit codes mirror validate.js: 0 = pass (warnings allowed), 1 =
 * validation error, 2 = fatal.
 *
 * Testnet (206) RPC outages are tolerated (skipped with a loud warning); the
 * public testnet endpoint reboots. Set ONCHAIN_STRICT_TESTNET=1 to make a 206
 * outage fatal.
 */

const fs = require('fs');
const path = require('path');

const { EXIT_CODES } = require('./utils/constants');
const { safeReadJSON } = require('./utils/safe-json');
const { runOnchainChecks } = require('./validators/onchain-validator');

function loadTokens(tokensDir) {
  if (!fs.existsSync(tokensDir)) return [];
  return fs
    .readdirSync(tokensDir)
    .filter(d => d.startsWith('0x'))
    .map(d => {
      const file = path.join(tokensDir, d, `${d}.json`);
      return safeReadJSON(file);
    });
}

function loadContracts(contractsDir) {
  if (!fs.existsSync(contractsDir)) return [];
  const out = [];
  for (const projectSlug of fs.readdirSync(contractsDir)) {
    const infoPath = path.join(contractsDir, projectSlug, 'info.json');
    if (!fs.existsSync(infoPath)) continue;
    const info = safeReadJSON(infoPath);
    if (!Array.isArray(info.contracts)) continue;
    for (const contract of info.contracts) {
      out.push({ projectSlug, contract });
    }
  }
  return out;
}

async function main() {
  const tokensDir = path.join(__dirname, '../tokens');
  const contractsDir = path.join(__dirname, '../contracts');

  console.log('\n🔗 On-chain cross-check of VinuChain Lists registry\n');
  console.log('='.repeat(60));

  const tokens = loadTokens(tokensDir);
  const contracts = loadContracts(contractsDir);

  const { errors, warnings, skippedChains } = await runOnchainChecks({
    tokens,
    contracts,
    log: console,
  });

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 On-chain Summary\n');
  console.log(`Tokens checked: ${tokens.length}`);
  console.log(`Contract entries checked: ${contracts.length}`);
  if (skippedChains.length) {
    console.log(`Skipped chains (RPC unavailable): ${skippedChains.join(', ')}`);
  }
  console.log(`Errors: ${errors}`);
  console.log(`Warnings: ${warnings}`);

  if (errors > 0) {
    console.error(`\n❌ On-chain validation failed with ${errors} error(s)\n`);
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }
  if (warnings > 0) {
    console.warn(`\n⚠️  On-chain validation passed with ${warnings} warning(s)\n`);
    process.exit(EXIT_CODES.SUCCESS);
  }
  console.log('\n✅ All on-chain checks passed!\n');
  process.exit(EXIT_CODES.SUCCESS);
}

if (require.main === module) {
  main().catch(e => {
    console.error(`\nFATAL ERROR: ${e.message}`);
    if (e.stack) console.error(e.stack);
    process.exit(EXIT_CODES.FATAL_ERROR);
  });
}

module.exports = { loadTokens, loadContracts };
