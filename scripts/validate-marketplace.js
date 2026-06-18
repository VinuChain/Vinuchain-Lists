#!/usr/bin/env node

/**
 * Validates the marketplace blocks inside contracts/{slug}/info.json.
 *
 * Checks:
 *   - Required fields are present
 *   - categories are drawn from the permitted whitelist
 *   - logo and url are HTTPS URLs
 *   - id values are unique per network (no two entries claim the same slug on
 *     the same chainId)
 *
 * Usage:
 *   node scripts/validate-marketplace.js
 *
 * Exit codes:
 *   0  all validations passed (warnings allowed)
 *   1  one or more validation errors
 */

const fs = require('fs');
const path = require('path');

const { safeReadJSON } = require('./utils/safe-json');

const CONTRACTS_DIR = path.join(__dirname, '../contracts');

const CATEGORY_WHITELIST = new Set([
  'DEX', 'Lending', 'NFT', 'Bridge', 'Governance', 'Staking', 'Tools', 'Other',
]);

const REQUIRED_FIELDS = [
  'id', 'title', 'url', 'logo', 'shortDescription', 'description',
  'categories', 'author', 'external', 'networks',
];

let errors = 0;
let warnings = 0;

function err(msg) {
  process.stderr.write(`  ERROR: ${msg}\n`);
  errors++;
}

function warn(msg) {
  process.stderr.write(`  WARN:  ${msg}\n`);
  warnings++;
}

function validateEntry(slug, mp) {
  process.stdout.write(`  Checking ${slug}...\n`);

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (mp[field] === undefined || mp[field] === null) {
      err(`${slug}: missing required field "${field}"`);
    }
  }

  // id must be a non-empty slug
  if (mp.id !== undefined && (typeof mp.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(mp.id))) {
    err(`${slug}: marketplace.id "${mp.id}" is not a valid lowercase slug`);
  }

  // url must be HTTPS
  if (mp.url && !mp.url.startsWith('https://')) {
    err(`${slug}: marketplace.url must start with https://`);
  }

  // logo must be HTTPS
  if (mp.logo && !mp.logo.startsWith('https://')) {
    err(`${slug}: marketplace.logo must start with https://`);
  }

  // site (optional) must be HTTPS when present
  if (mp.site !== undefined && !mp.site.startsWith('https://')) {
    err(`${slug}: marketplace.site must start with https://`);
  }

  // categories whitelist
  if (Array.isArray(mp.categories)) {
    for (const cat of mp.categories) {
      if (!CATEGORY_WHITELIST.has(cat)) {
        err(`${slug}: unknown category "${cat}" — allowed: ${[...CATEGORY_WHITELIST].join(', ')}`);
      }
    }
    if (mp.categories.length === 0) {
      err(`${slug}: marketplace.categories must have at least one entry`);
    }
  }

  // networks must reference known chain IDs
  if (Array.isArray(mp.networks)) {
    for (const chainId of mp.networks) {
      if (chainId !== 206 && chainId !== 207) {
        err(`${slug}: unknown chainId ${chainId} in marketplace.networks (allowed: 206, 207)`);
      }
    }
    if (mp.networks.length === 0) {
      err(`${slug}: marketplace.networks must have at least one entry`);
    }
  }

  // external must be boolean
  if (mp.external !== undefined && typeof mp.external !== 'boolean') {
    err(`${slug}: marketplace.external must be a boolean`);
  }

  // shortDescription length advisory
  if (mp.shortDescription && mp.shortDescription.length > 160) {
    warn(`${slug}: shortDescription is ${mp.shortDescription.length} chars (recommended ≤160)`);
  }
}

function main() {
  process.stdout.write('\nValidating marketplace entries\n');
  process.stdout.write('='.repeat(50) + '\n');

  if (!fs.existsSync(CONTRACTS_DIR)) {
    process.stderr.write(`FATAL: contracts directory not found: ${CONTRACTS_DIR}\n`);
    process.exit(1);
  }

  const allEntries = []; // { slug, mp, chainId } — for uniqueness checks

  for (const slug of fs.readdirSync(CONTRACTS_DIR).sort()) {
    const infoPath = path.join(CONTRACTS_DIR, slug, 'info.json');
    if (!fs.existsSync(infoPath)) continue;

    let data;
    try {
      data = safeReadJSON(infoPath);
    } catch (e) {
      err(`${slug}: could not read info.json: ${e.message}`);
      continue;
    }

    if (!data || typeof data !== 'object' || !data.marketplace) continue;

    validateEntry(slug, data.marketplace);

    if (Array.isArray(data.marketplace.networks)) {
      for (const chainId of data.marketplace.networks) {
        allEntries.push({ slug, id: data.marketplace.id, chainId });
      }
    }
  }

  // Uniqueness: no two entries may share the same id on the same chainId
  const seen = new Map(); // "chainId:id" -> slug
  for (const { slug, id, chainId } of allEntries) {
    if (!id) continue;
    const key = `${chainId}:${id}`;
    if (seen.has(key)) {
      err(`Duplicate marketplace id "${id}" on chainId ${chainId}: "${slug}" collides with "${seen.get(key)}"`);
    } else {
      seen.set(key, slug);
    }
  }

  process.stdout.write('='.repeat(50) + '\n');

  if (errors > 0) {
    process.stderr.write(`\nFAILED: ${errors} error(s), ${warnings} warning(s)\n`);
    process.exit(1);
  } else if (warnings > 0) {
    process.stdout.write(`\nPASSED with ${warnings} warning(s)\n`);
  } else {
    process.stdout.write('\nAll marketplace validations passed.\n');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`FATAL: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { validateEntry, CATEGORY_WHITELIST, REQUIRED_FIELDS };
