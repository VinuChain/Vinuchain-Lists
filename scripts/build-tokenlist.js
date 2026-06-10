#!/usr/bin/env node

/**
 * Builds a Uniswap-tokenlist-compatible artifact from the token registry so
 * consumers can pin an immutable, versioned file (attached to a GitHub Release)
 * instead of reading a moving `main` (AUD-07).
 *
 * Output is deterministic: tokens are sorted by (chainId, address) and the
 * version is taken from package.json, so the same registry + version always
 * produces a byte-identical list. logoURI points at the tagged ref when REF is
 * provided (e.g. the release tag) so the logo URL is also immutable.
 *
 * Usage:
 *   node scripts/build-tokenlist.js [--out <path>] [--ref <git-ref>]
 *   REF env var is also honoured (the release workflow sets it to the tag).
 */

const fs = require('fs');
const path = require('path');

const { safeReadJSON } = require('./utils/safe-json');
const pkg = require('../package.json');

const REPO_SLUG = 'VinuChain/Vinuchain-Lists';
const TOKENS_DIR = path.join(__dirname, '../tokens');

function parseArgs(argv) {
  const args = { out: null, ref: process.env.REF || 'main' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--ref') args.ref = argv[++i];
  }
  return args;
}

function parseSemver(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!m) return { major: 0, minor: 0, patch: 0 };
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function loadTokens() {
  return fs
    .readdirSync(TOKENS_DIR)
    .filter(d => d.startsWith('0x'))
    .map(d => safeReadJSON(path.join(TOKENS_DIR, d, `${d}.json`)));
}

function logoUri(token, ref) {
  // Prefer the entry's own logoURI when it is an external HTTPS URL; otherwise
  // point at the physical logo file at the pinned ref. We can't know the exact
  // extension cheaply here, so we resolve it from disk.
  if (token.logoURI && /^https:\/\//.test(token.logoURI)) {
    return token.logoURI;
  }
  const dir = path.join(TOKENS_DIR, token.address);
  const logo = fs
    .readdirSync(dir)
    .find(f => /\.(png|jpg|jpeg|webp|svg)$/i.test(f) && f.startsWith(token.address));
  if (!logo) return undefined;
  return `https://raw.githubusercontent.com/${REPO_SLUG}/${ref}/tokens/${token.address}/${logo}`;
}

function buildTokenList(ref) {
  const tokens = loadTokens()
    .map(t => {
      const entry = {
        chainId: t.chainId,
        address: t.address,
        name: t.name,
        symbol: t.symbol,
        decimals: t.decimals,
      };
      const uri = logoUri(t, ref);
      if (uri) entry.logoURI = uri;
      return entry;
    })
    .sort((a, b) => a.chainId - b.chainId || a.address.localeCompare(b.address));

  return {
    name: 'VinuChain Default List',
    timestamp: process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date().toISOString(),
    version: parseSemver(pkg.version),
    tags: {},
    logoURI: `https://raw.githubusercontent.com/${REPO_SLUG}/${ref}/tokens/EXAMPLE.md`,
    keywords: ['vinuchain', 'default', 'tokens'],
    tokens,
  };
}

function main() {
  const { out, ref } = parseArgs(process.argv);
  const list = buildTokenList(ref);
  const json = JSON.stringify(list, null, 2) + '\n';

  if (out) {
    fs.writeFileSync(out, json);
    process.stderr.write(`Wrote ${list.tokens.length} tokens to ${out} (ref: ${ref})\n`);
  } else {
    process.stdout.write(json);
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

module.exports = { buildTokenList, parseSemver };
