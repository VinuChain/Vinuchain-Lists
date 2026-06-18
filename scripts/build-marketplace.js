#!/usr/bin/env node

/**
 * Builds per-network marketplace JSON files from each contracts/{slug}/info.json
 * that carries a `marketplace` block.  Output is Blockscout-shaped and is the
 * authoritative source of truth consumed by VinuExplorer-Backend.
 *
 * Deterministic: entries are sorted by `id` within each network so the output
 * is stable across runs.
 *
 * Usage:
 *   node scripts/build-marketplace.js [--out DIR]
 *   Default output directory: dist/
 *
 * Writes:
 *   DIR/mainnet-marketplace.json   (chainId 207 entries)
 *   DIR/testnet-marketplace.json   (chainId 206 entries)
 */

const fs = require('fs');
const path = require('path');

const { safeReadJSON } = require('./utils/safe-json');

const CONTRACTS_DIR = path.join(__dirname, '../contracts');

// chainId → output filename
const NETWORK_FILES = {
  207: 'mainnet-marketplace.json',
  206: 'testnet-marketplace.json',
};

function parseArgs(argv) {
  const args = { out: path.join(__dirname, '../dist') };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

/**
 * Read all contracts/{slug}/info.json files and return those with a `marketplace`
 * block.
 */
function loadMarketplaceEntries() {
  if (!fs.existsSync(CONTRACTS_DIR)) {
    throw new Error(`Contracts directory not found: ${CONTRACTS_DIR}`);
  }

  const entries = [];

  for (const slug of fs.readdirSync(CONTRACTS_DIR).sort()) {
    const infoPath = path.join(CONTRACTS_DIR, slug, 'info.json');
    if (!fs.existsSync(infoPath)) continue;

    let data;
    try {
      data = safeReadJSON(infoPath);
    } catch (e) {
      process.stderr.write(`WARN: could not read ${infoPath}: ${e.message}\n`);
      continue;
    }

    if (!data || typeof data !== 'object' || !data.marketplace) continue;
    entries.push({ slug, marketplace: data.marketplace });
  }

  return entries;
}

/**
 * Shape a marketplace block into the Blockscout output entry.
 * Optional fields are only included when present on the source object.
 */
function toOutputEntry(mp) {
  const entry = {
    id: mp.id,
    title: mp.title,
    url: mp.url,
    logo: mp.logo,
    shortDescription: mp.shortDescription,
    description: mp.description,
    categories: mp.categories,
    author: mp.author,
    external: mp.external,
  };

  // Optional Blockscout field used by some builds
  if (mp.site !== undefined) entry.site = mp.site;

  // Optional socials — only emit when defined
  if (mp.twitter !== undefined) entry.twitter = mp.twitter;
  if (mp.telegram !== undefined) entry.telegram = mp.telegram;
  if (mp.discord !== undefined) entry.discord = mp.discord;
  if (mp.github !== undefined) entry.github = mp.github;

  return entry;
}

/**
 * Build per-network arrays from the loaded entries.
 * Returns a Map<chainId, Array<outputEntry>> sorted by id.
 */
function buildNetworkMaps(entries) {
  const maps = new Map();
  for (const chainId of Object.keys(NETWORK_FILES).map(Number)) {
    maps.set(chainId, []);
  }

  for (const { slug, marketplace: mp } of entries) {
    if (!Array.isArray(mp.networks)) {
      process.stderr.write(`WARN: ${slug} marketplace.networks is missing or not an array — skipping\n`);
      continue;
    }

    for (const chainId of new Set(mp.networks)) {
      if (!maps.has(chainId)) {
        process.stderr.write(`WARN: ${slug} lists unknown chainId ${chainId} in marketplace.networks — skipping\n`);
        continue;
      }
      maps.get(chainId).push(toOutputEntry(mp));
    }
  }

  // Sort each network's list deterministically by id
  for (const [, list] of maps) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  return maps;
}

function main() {
  const { out } = parseArgs(process.argv);

  const entries = loadMarketplaceEntries();
  const networkMaps = buildNetworkMaps(entries);

  // Ensure output directory exists
  if (!fs.existsSync(out)) {
    fs.mkdirSync(out, { recursive: true });
  }

  for (const [chainId, filename] of Object.entries(NETWORK_FILES)) {
    const list = networkMaps.get(Number(chainId)) || [];
    const outPath = path.join(out, filename);
    fs.writeFileSync(outPath, JSON.stringify(list, null, '\t') + '\n');
    process.stderr.write(`Wrote ${list.length} entries to ${outPath}\n`);
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

module.exports = { loadMarketplaceEntries, buildNetworkMaps, toOutputEntry };
