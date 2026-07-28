# VinuChain Lists

**Registry of verified tokens and smart contracts on VinuChain**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Quick Navigation

**Getting Started:**
[Quick Start](#quick-start) • [Installation](#installation) • [Validation Commands](#validation-commands)

**Submit:**
[Submit Token](#token-submission-guide) • [Submit Contract](#contract-project-submission) • [Submit dApp](#dapp-marketplace-directory) • [Submission Guidelines](#submission-guidelines)

**Documentation:**
[Validation Rules](#validation-rules) • [Architecture](#architecture)

**Usage:**
[Using the Registry](#using-the-registry) • [Advanced Usage](#advanced-usage) • [Development](#development)

---

## Overview

VinuChain Lists is a **community-maintained registry** providing:

- **Token Registry**: Verified ERC-20 tokens with metadata for wallet and DEX integration
- **Contract Registry**: Smart contract projects with source code, ABIs, and comprehensive validation
- **dApp Marketplace**: Source of truth for the [VinuExplorer](https://mainnet.vinuexplorer.org) marketplace directory — generated from `contracts/{slug}/info.json` entries that carry a `marketplace` block

---

## Network Information

This registry covers **two** VinuChain networks. Every token and contract entry
carries a required `chainId` field so consumers can tell them apart
programmatically — an address without a chainId is half an address.

| Property | Mainnet | Testnet |
|----------|---------|---------|
| **Chain Name** | VinuChain | VinuChain Testnet |
| **Chain ID** (`chainId`) | `207` | `206` |
| **RPC Endpoint** | https://rpc.vinuchain.org | https://vinufoundation-rpc.com |
| **Block Explorer** | [VinuExplorer](https://vinuexplorer.org/) | — |
| **Native Token** | VC | VC |

Most listed content is mainnet-207 (the bridged tokens, VinuSwap, VinuFinance,
Vita Inu, and the core SFC/NodeDriver contracts). Testnet-206 entries are the
VinuChain Name Service (VNS) deployment and the legacy/active quota contracts;
these are tagged `"chainId": 206` and the CI on-chain check verifies them
against the testnet RPC (tolerating its periodic reboots).

### Bytecode pinning with `codeHash` and `implCodeHash`

A correctly-checksummed address proves the address is *well-formed*, not that it
hosts the contract the entry claims. The `codeHash` and `implCodeHash` fields add
on-chain pinning to close that gap.

**`codeHash`** holds the keccak256 of the deployed runtime bytecode (`eth_getCode`)
for the entry's address on its declared `chainId`. It is **required** on every
token and contract entry (enforced by the schema, so off-chain `npm run validate`
rejects a missing pin in CI regardless of RPC reachability) — this closes the
delete-the-pin-and-swap-the-address bypass. `npm run validate:onchain` then
fetches the live code, hashes it, and hard-errors on any mismatch, detecting a
substituted address whose bytecode differs from the expected contract type. Run
`npm run capture:codehashes` to populate the pin for a new entry.

**Scope of `codeHash`:** it pins the contract's *type* (bytecode), not a unique
*instance*. Multiple contracts can legitimately share identical runtime bytecode —
for example BTC@VinuChain, USDT@VinuChain, and ETH@VinuChain are all deployed from
the same bridged-token factory and share one `codeHash`. A `codeHash` match therefore
proves "the expected contract bytecode is deployed here" but cannot by itself
distinguish which of several identically-bytecoded instances is present.

**ERC-20 tokens fail closed on per-instance identity:** because `codeHash` alone
cannot distinguish instances, token entries always require at least one cleanly-decoded
matching on-chain string — `symbol()` is checked first; `name()` is tried as a
fallback if `symbol()` reverts. If neither decodes to the declared value that is a
hard error, regardless of whether `codeHash` matches. `decimals()` is always a hard
check too. A cleanly-decoded but mismatching `symbol()` or `name()` is also a hard
error — that is the phishing-substitution signal this validator exists to catch.

**`implCodeHash`** (contract entries only) adds depth for EIP-1967 transparent/UUPS
proxy contracts. When present, the validator reads the implementation slot
(`0x360894…`) via `eth_getStorageAt` and hard-errors if the implementation address's
bytecode keccak256 differs from the pinned value — catching an implementation upgrade
or replacement that leaves the proxy shell's `codeHash` unchanged.

Capture or refresh all pins with `npm run capture:codehashes`, which fetches
`eth_getCode` (and for proxy-shaped entries also `eth_getStorageAt`) for every
registry entry and writes the keccak256 values back. It never overwrites an existing
pin that disagrees with the live value without `--force` — a disagreement is surfaced
loudly because it may signal a substituted or upgraded contract. Testnet-206 entries
unreachable during a reboot are skipped and reported as left-unpinned.

---

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/VinuChain/vinuchain-lists.git
cd vinuchain-lists

# Install dependencies
npm install

# Validate the repository
npm run validate

# Run test suite
npm test
```

### Validation Commands

```bash
npm run validate           # Validate tokens and contracts (off-chain)
npm run validate:onchain   # Cross-check every entry against the live chain it declares
npm run capture:codehashes # Pin each entry's deployed-bytecode keccak256 as codeHash
npm run audit:vinuchain-quota  # Report live testnet Quota proxy/list alignment
npm test                   # Run all 204 tests
npm run test:unit          # Run unit tests only
npm run test:security      # Run security tests only
npm run test:integration   # Run integration tests only
npm run test:all           # Run validation + all tests
```

For the Payback receiver rollout, use strict mode after the Quota proxy upgrade
and VinuExplorer verification:

```bash
REQUIRE_QUOTA_LISTS_CURRENT=true npm run audit:vinuchain-quota
```

---

## Repository Structure

```
vinuchain-lists/
├── tokens/                     # Token registry (7 tokens)
│   └── {address}/              # EIP-55 checksummed address
│       ├── {address}.json      # Token metadata
│       └── {address}.png       # Token logo (REQUIRED - .png/.jpg/.webp)
│
├── contracts/                  # Contract project registry (1 project)
│   └── {project-slug}/         # Project directory
│       ├── info.json           # Project metadata
│       ├── {Contract}.sol      # Solidity source code
│       └── {Contract}_abi.json # Contract ABI
│
├── schemas/                    # JSON Schema definitions
│   ├── token.schema.json       # Token validation schema
│   └── contract.schema.json    # Contract validation schema
│
├── scripts/                    # Validation system
│   ├── validate.js             # Main validation script
│   ├── utils/                  # Utility modules
│   │   ├── constants.js        # Configuration
│   │   ├── safe-json.js        # Secure JSON parsing
│   │   ├── address-validator.js# EIP-55 validation
│   │   ├── url-validator.js    # SSRF protection
│   │   ├── file-utils.js       # Safe file operations
│   │   └── logger.js           # Structured logging
│   └── validators/             # Specialized validators
│       ├── email-validator.js  # Email domain validation
│       ├── abi-validator.js    # ABI structure validation
│       ├── solidity-validator.js# Solidity security patterns
│       └── logo-validator.js   # Logo file validation
│
└── tests/                      # Comprehensive test suite (204 tests)
    ├── unit/                   # Unit tests (126 tests)
    ├── integration/            # Integration tests (6 tests)
    └── security/               # Security tests (72 tests)
```
---

## Contract Project Submission

### Project Structure

Each contract project requires:

```
contracts/{project-slug}/
├── info.json                    # Project metadata
├── {ContractName}.sol           # Solidity source (for each contract)
└── {ContractName}_abi.json      # ABI JSON (for each contract)
```

### Adding Contracts to Existing Projects

To add a new contract to an existing project (e.g., `vinuswap`):

1. **Update `info.json`** - Add new contract to the `contracts` array:
   ```json
   {
     "contracts": [
       // ... existing contracts ...
       {
         "name": "NewContract",
         "address": "0x...",
         "type": "helper",
         "description": "New contract description"
       }
     ]
   }
   ```

2. **Add Solidity source:** `contracts/{project}/NewContract.sol`

3. **Add ABI:** `contracts/{project}/NewContract_abi.json`

4. **Validate:** `npm run validate`

5. **Submit PR** with all three changes

**Requirements:**
- Contract name must be unique within the project (duplicate detection active)
- Must follow PascalCase naming convention
- Address must not duplicate any existing address in the registry
- All validation rules apply

---

## Token Submission Guide

### Required Files

Each token submission requires **two files** in `tokens/{address}/`:

1. **`{address}.json`** - Token metadata (see fields below)
2. **`{address}.png`** - Token logo image (required)

### Logo Requirements

| Attribute | Requirement |
|-----------|-------------|
| **Filename** | Must match token address: `{address}.png`, `{address}.jpg`, or `{address}.webp` |
| **Format** | PNG (preferred), JPG, or WebP |
| **Dimensions** | 200x200px recommended (square aspect ratio) |
| **File Size** | Max 100KB recommended, 500KB hard limit |
| **Background** | Transparent preferred (PNG) |

### Required JSON Fields

```json
{
  "symbol": "TOKEN",              // Uppercase, 1-20 chars
  "name": "Token Name",           // 1-100 chars
  "address": "0x...",             // EIP-55 checksummed
  "decimals": 18                  // 0-77 (values >18 trigger warning)
}
```

### Optional Fields

```json
{
  "description": "Brief description of the token and its purpose (10-500 chars)",
  "codeHash": "0x...",            // keccak256 of deployed bytecode (pins type, not instance — see above)
  "project": "project-slug",      // Reference to contracts/{project-slug}/
  "logoURI": "https://...",       // HTTPS URL to logo (200x200px PNG recommended).
                                  // Prefer this repo's own copy of your logo file
                                  // (see "Logo hosting" below) over a third-party host.
  "website": "https://...",       // Official website
  "support": "email@domain.com",  // Support email (no disposable domains)
  "github": "https://github.com/org/repo",
  "twitter": "https://twitter.com/handle",
  "telegram": "https://t.me/channel",
  "discord": "https://discord.gg/invite",
  "medium": "https://medium.com/publication",
  "linkedin": "https://linkedin.com/company/name",
  "instagram": "https://instagram.com/username",
  "facebook": "https://facebook.com/pagename",
  "reddit": "https://reddit.com/r/community",
  "youtube": "https://www.youtube.com/c/channelname",
  "coingecko": "https://www.coingecko.com/...",
  "coinmarketcap": "https://coinmarketcap.com/...",
  "redFlags": [                   // Security warnings (structured)
    {
      "severity": "high",
      "description": "Clear description of concern",
      "evidence": "https://link-to-proof",
      "reportedDate": "2025-01-15"
    }
  ]
}
```

### Submission Process

#### Option 1: GitHub Issue (Easiest)
1. Click **[New Issue](../../issues/new/choose)**
2. Select **"Token Submission"** template
3. Fill out the form with all required information
4. Submit for automated validation and review

#### Option 2: Pull Request (Advanced)
1. Fork this repository
2. Create directory: `tokens/{address}/`
3. Create file: `tokens/{address}/{address}.json`
4. Run validation: `npm run validate`
5. Create pull request with your changes

**Important:** Address must be EIP-55 checksummed. Use [EIP-55 Converter](https://ethsum.netlify.app/) if needed.

---

## Contract Project Submission

### Project Structure

Each contract project requires:

```
contracts/{project-slug}/
├── info.json                    # Project metadata
├── {ContractName}.sol           # Solidity source (for each contract)
└── {ContractName}_abi.json      # ABI JSON (for each contract)
```

### info.json Format

```json
{
  "name": "Project Name",
  "website": "https://project.io",
  "description": "Brief project description",
  "contact": "team@project.io",
  "security": "security@project.io",
  "contracts": [
    {
      "name": "Factory",                                    // PascalCase only
      "address": "0xd74dEe1C78D5C58FbdDe619b707fcFbAE50c3EEe", // EIP-55 checksummed
      "type": "factory",                                    // See contract types below
      "codeHash": "0x...",                                  // Optional bytecode-type pin (see above)
      "implCodeHash": "0x...",                              // Optional EIP-1967 impl pin (proxy contracts only)
      "description": "Factory contract description"
    }
  ],
  "social": {
    "github": "https://github.com/project",
    "twitter": "https://twitter.com/project",
    "telegram": "https://t.me/project"
  }
}
```

### Contract Types

- `token`, `factory`, `router`, `controller`, `manager`, `quoter`, `helper`
- `oracle`, `vault`, `staking`, `governance`, `bridge`, `nft`, `pair`, `pool`, `other`

### Solidity Requirements

- Must include `pragma solidity` directive
- Should include `// SPDX-License-Identifier:`
- Must contain contract/interface/library declaration matching the contract name
- **Security Notice:** The validator detects dangerous patterns (`selfdestruct`, `delegatecall`, `tx.origin`)

---

### Output Formats

**Human-Readable (Default):**
```bash
npm run validate

✅ VINU (Vita Inu) - 0x00c1E515EA9579856304198EFb15f525A0bb50f6
Total tokens validated: 7
All validations passed!
```

**Machine-Parseable JSON:**
```bash
LOG_FORMAT=json npm run validate

{"timestamp":"2025-11-23T...","level":"success","message":"VINU (Vita Inu)..."}
```

---

## Using the Registry

### Pin a release, don't track `main` (recommended)

`main` is a moving target: every merged PR is instantly live with no rollback
point. For production use, **pin a tagged release** instead. A
[GitHub Release](https://github.com/VinuChain/Vinuchain-Lists/releases) is
published with:

- `vinuchain.tokenlist.json` — a [Uniswap-tokenlist](https://tokenlists.org/)
  format file (one entry per token, with `chainId`, `address`, `symbol`,
  `name`, `decimals`, `logoURI`) suitable for direct consumption by wallets and
  DEX frontends;
- `vinuchain-lists-registry-<tag>.tar.gz` — the full `tokens/`, `contracts/`,
  and `schemas/` tree;
- `SHA256SUMS` — checksums for both artifacts.

Releases are cut **automatically**: any push to `main` that changes `tokens/`,
`contracts/`, or `schemas/` publishes a new patch version, gated on `npm run
validate` and the on-chain cross-check. A release therefore never lags `main` by
more than one CI run — which matters, because a pinned artifact that silently
rots is worse than no artifact at all: it keeps serving data (a logo URL, an
address) long after `main` has corrected it. Pushing a `v*` tag by hand still
cuts that exact version, and the workflow can also be run manually from the
Actions tab with an explicit version.

Note that `logoURI` values pointing at this repository are rewritten to the
released tag inside the artifact, so a pinned release keeps rendering the logos
it shipped with. Entries whose `logoURI` points at a third-party host cannot be
pinned this way and remain subject to that host's uptime — prefer committing the
logo to the token's directory and pointing `logoURI` at this repo.

```javascript
// Pin the tokenlist at a specific release tag (immutable — replace the tag
// with the release you have vetted; see the Releases page for the latest):
const TAG = 'v1.2.0';
const url =
  `https://github.com/VinuChain/Vinuchain-Lists/releases/download/${TAG}/vinuchain.tokenlist.json`;
// Or track the newest release (mutable, convenient for dev):
//   https://github.com/VinuChain/Vinuchain-Lists/releases/latest/download/vinuchain.tokenlist.json
const list = await (await fetch(url)).json();
const mainnetTokens = list.tokens.filter(t => t.chainId === 207);
```

The examples below read a local clone for convenience, but should be treated as
illustrative — prefer the pinned release artifact for anything user-facing.

### Load Token Data

```javascript
// Load specific token
const token = require('./tokens/0x00c1E515EA9579856304198EFb15f525A0bb50f6/0x00c1E515EA9579856304198EFb15f525A0bb50f6.json');

console.log(token.symbol);    // "VINU"
console.log(token.name);      // "Vita Inu"
console.log(token.decimals);  // 18
console.log(token.website);   // "https://vitainu.org"
```

### Load Contract Data

```javascript
// Load project information
const vinuswap = require('./contracts/vinuswap/info.json');

console.log(vinuswap.name);       // "VinuSwap"
console.log(vinuswap.website);    // "https://vinuswap.io"
console.log(vinuswap.contracts);  // Array of 6 contracts

// Load contract ABI
const factoryABI = require('./contracts/vinuswap/Factory_abi.json');
const routerABI = require('./contracts/vinuswap/Router_abi.json');

// Use with ethers.js
const { ethers } = require('ethers');
const factory = new ethers.Contract(
  vinuswap.contracts[0].address,
  factoryABI,
  provider
);
```

### Iterate All Tokens

```javascript
const fs = require('fs');
const path = require('path');

const tokensDir = './tokens';
const addresses = fs.readdirSync(tokensDir)
  .filter(f => fs.statSync(path.join(tokensDir, f)).isDirectory());

const allTokens = addresses.map(address => {
  const tokenPath = path.join(tokensDir, address, `${address}.json`);
  return require(tokenPath);
});

console.log(`Total tokens: ${allTokens.length}`);
allTokens.forEach(token => {
  console.log(`${token.symbol}: ${token.name}`);
});
```

---

## Validation Rules

### Token Requirements

**Required Files:**
- **Logo file** - `{address}.png`, `{address}.jpg`, or `{address}.webp` (max 500KB, 200x200px recommended)

**Required JSON Fields:**
- `symbol` - Uppercase alphanumeric (1-20 characters)
- `name` - Token name (1-100 characters)
- `address` - EIP-55 checksummed Ethereum address (NOT zero address)
- `decimals` - Integer (0-77, values > 18 show warning)

**Optional JSON Fields:**
- `project` - Reference to contracts/{project-slug} if token has contracts
- `logoURI` - Optional external HTTPS URL to logo (physical file is REQUIRED)
- `website` - Official website (HTTPS only)
- `support` - Support email (blocks disposable email domains)
- `github`, `twitter`, `telegram`, `discord` - Social links (HTTPS only)
- `coingecko`, `coinmarketcap` - Listing URLs
- `redFlags` - Structured security warnings with evidence

#### Logo hosting

A physical logo file in the token's directory is always required. `logoURI` is
optional and may point anywhere, but **point it at this repository's copy**:

```
https://raw.githubusercontent.com/VinuChain/vinuchain-lists/main/tokens/{ADDRESS}/{ADDRESS}.png
```

A third-party host is a dependency the registry cannot repair. When one goes
away, every wallet and explorer reading this list renders a broken image, and
fixing it needs a PR per consumer rather than a one-line change here. Self-hosted
logos also get rewritten to the release tag inside release artifacts, so pinned
consumers keep rendering the logo that shipped with the version they vetted.

To change a logo, replace the PNG in the token's directory (and update `logoURI`
if it points elsewhere). Consumers that read `main` pick it up automatically.

### Contract Requirements

**Required Files:**
- `info.json` - Project metadata and contract list
- `{ContractName}.sol` - Solidity source for each contract
- `{ContractName}_abi.json` - ABI for each contract

**Contract Name Rules:**
- Must be PascalCase (e.g., `Factory`, `TokenRouter`)
- Alphanumeric only (no special characters)
- Must match the declaration in .sol file
- No duplicates within same project

---

## Security

### Report Security Issues

**For Repository Security:**
- Email: hello@vinuchain.org
- Include: Detailed description, reproduction steps, impact assessment

**For Token Contract Security:**
- Check individual token `support` email in their JSON file
- Use project `security` email if specified

**For Smart Contract Security:**
- Check project `security` email in `contracts/{project}/info.json`
- Contact project team directly

**Please do NOT open public issues for security vulnerabilities.**

---

## Submission Guidelines

### Before Submitting

1. **Validate your submission locally:**
   ```bash
   npm install
   npm run validate
   ```

2. **Ensure all checks pass:**
   - ✅ Logo file exists (`{address}.png/jpg/webp`, max 500KB)
   - ✅ EIP-55 checksum is correct
   - ✅ All URLs use HTTPS
   - ✅ Email domains are legitimate (no temp mail)
   - ✅ Contract names are PascalCase
   - ✅ Solidity source includes pragma
   - ✅ ABIs are valid JSON arrays

3. **Run tests to verify:**
   ```bash
   npm test
   ```

### Submission Methods

**GitHub Issue (Recommended for beginners):**
- Guided form with validation
- Automatic checks
- Clear error messages
- [Submit Token](../../issues/new?template=token-submission.yml) or [Submit Contract](../../issues/new?template=contract-submission.yml)

**Pull Request (For developers):**
- Direct repository modification
- Requires local validation
- Faster review for correct submissions
- [Create PR](../../compare)

### Review Process

1. **Automated Validation** - GitHub Actions runs validation script
2. **Security Checks** - 72 security tests verify submission safety
3. **Manual Review** - Maintainers verify legitimacy
4. **Approval** - Merged if all checks pass

**Typical Review Time:** 1-3 days for valid submissions

---

## Development

### Local Development

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/vinuchain-lists.git
cd vinuchain-lists

# Install dependencies
npm install

# Make your changes
# Add token or contract files following the structure

# Validate
npm run validate

# Run tests
npm test

# Check for security issues
npm audit
```

### Test-Driven Development

```bash
# Watch mode - tests rerun on file changes
npm run test:watch

# Run specific test suites
npm run test:unit       # Unit tests
npm run test:security   # Security tests
npm run test:integration # Integration tests

# Verbose output
npm run test:verbose
```

### Module Documentation

All modules are fully documented with JSDoc:

```javascript
/**
 * Validate EIP-55 checksum for VinuChain address
 * @param {string} address - Address to validate
 * @param {string} context - Context for error messages
 * @returns {{valid: boolean, checksummed?: string, error?: string}} Validation result
 */
function validateEIP55Checksum(address, context = 'address') {
  // Implementation with comprehensive error handling
}
```

---

## Advanced Usage

### JSON Output for Automation

```bash
# Get JSON output for programmatic parsing
LOG_FORMAT=json npm run validate > validation-results.json

# Parse results
cat validation-results.json | jq '.level == "error"'
```

### Custom Validation

```javascript
const { validateTokens, validateContracts } = require('./scripts/validate');

// Validate tokens programmatically
const tokenCount = validateTokens('./tokens');
console.log(`Validated ${tokenCount} tokens`);

// Validate contracts programmatically
const { projectCount, contractCount } = validateContracts('./contracts');
console.log(`Validated ${projectCount} projects with ${contractCount} contracts`);
```

### Integration with CI/CD

```yaml
# GitHub Actions example
- name: Validate VinuChain Lists
  run: |
    npm ci
    npm run test:all  # Validation + all tests

- name: Security Audit
  run: npm audit --audit-level=moderate
```

---

## Architecture

### Modular Design

VinuChain Lists uses a **modular architecture** for maintainability and testability:

**Utility Modules** (`scripts/utils/`):
- `constants.js` - Configuration management
- `safe-json.js` - Secure JSON parsing with prototype pollution protection
- `address-validator.js` - EIP-55 validation and path safety
- `url-validator.js` - URL validation with SSRF protection
- `file-utils.js` - Safe file operations with path traversal protection
- `logger.js` - Structured logging (JSON + human-readable)

**Validator Modules** (`scripts/validators/`):
- `email-validator.js` - Email domain validation
- `abi-validator.js` - Comprehensive ABI structure validation
- `solidity-validator.js` - Solidity security pattern detection
- `logo-validator.js` - Logo file existence and format validation

**Core:**
- `validate.js` - Orchestrator that coordinates all validation

---

## dApp Marketplace Directory

This repository is the **source of truth** for the [VinuExplorer](https://mainnet.vinuexplorer.org) dApp marketplace.  The marketplace JSON consumed by VinuExplorer-Backend is generated from `contracts/{slug}/info.json` entries that carry an optional `marketplace` block.

### How it works

1. Each project's `info.json` may include a top-level `"marketplace"` object.
2. Running `npm run build:marketplace` reads every `contracts/{slug}/info.json`, selects entries with a `marketplace` block, and writes two output files:
   - `dist/mainnet-marketplace.json` — entries where `marketplace.networks` includes `207`
   - `dist/testnet-marketplace.json` — entries where `marketplace.networks` includes `206`
3. VinuExplorer-Backend copies these files into its assets at deploy time.

### `marketplace` schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Lowercase slug, unique per network (e.g. `"vinuswap"`) |
| `title` | string | yes | Display name shown in the marketplace |
| `url` | string (https) | yes | Primary dApp URL |
| `logo` | string (https) | yes | Logo image URL (SVG or PNG) |
| `shortDescription` | string | yes | One-line summary (max 160 chars) |
| `description` | string | yes | Full description shown on the detail page |
| `categories` | array | yes | One or more of the values below |
| `author` | string | yes | Team or organisation name |
| `external` | boolean | yes | `true` when the dApp is hosted outside the explorer |
| `networks` | integer[] | yes | Chain IDs to appear on: `207` = mainnet, `206` = testnet |
| `site` | string (https) | no | Optional secondary site URL (some Blockscout builds) |
| `twitter` | string | no | Twitter/X profile URL |
| `telegram` | string | no | Telegram group or channel URL |
| `discord` | string | no | Discord server invite URL |
| `github` | string | no | GitHub organisation or repository URL |

### Category whitelist

`DEX` · `Lending` · `NFT` · `Bridge` · `Governance` · `Staking` · `Tools` · `Other`

### Submit a dApp

To list your dApp in the VinuExplorer marketplace, open an issue using the submission form:

**[Submit your dApp](https://github.com/VinuChain/Vinuchain-Lists/issues/new?template=dapp-submission.yml)**

Approved submissions are added to this repository and automatically appear in the next VinuExplorer deploy.

### Build commands

```bash
# Generate dist/mainnet-marketplace.json and dist/testnet-marketplace.json
npm run build:marketplace

# Validate all marketplace blocks in contracts/{slug}/info.json
npm run validate:marketplace
```

---

## Community

### Get Involved

- **Report Issues:** [GitHub Issues](../../issues)
- **Discussions:** [GitHub Discussions](../../discussions)
- **Submit Tokens:** [Token Submission Form](../../issues/new?template=token-submission.yml)
- **Submit Contracts:** [Contract Submission Form](../../issues/new?template=contract-submission.yml)
- **Submit dApp:** [dApp Submission Form](../../issues/new?template=dapp-submission.yml)

### Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please read our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Resources

### Documentation

- **[tokens/EXAMPLE.md](tokens/EXAMPLE.md)** - Detailed token submission guide
- **[CHANGELOG.md](CHANGELOG.md)** - Version history

### Links

- **VinuChain Website:** [vinuchain.org](https://vinuchain.org)
- **Block Explorer:** [VinuExplorer](https://vinuexplorer.org/)
- **RPC Endpoint:** https://rpc.vinuchain.org/
- **GitHub:** [VinuChain/vinuchain-lists](https://github.com/VinuChain/vinuchain-lists)

---

## Requirements

- **Node.js:** >= 18.0.0
- **npm:** >= 9.0.0

## Dependencies

**Production Dependencies:** None (data repository)

**Development Dependencies:**
- `ajv` ^8.17.1 - JSON Schema validation
- `ajv-formats` ^3.0.1 - Format validators (email, URI)
- `ethers` ^6.13.0 - EIP-55 checksum validation
- `mocha` ^11.7.5 - Test framework
- `chai` ^4.5.0 - Assertion library

**Dependency Status:** ✅ All secure (0 vulnerabilities)

---

## License

MIT License - see [LICENSE](LICENSE) for full text.

Copyright © 2025 VinuChain Community

---

## Acknowledgments

**Created by:** [@ElemontCapital](https://github.com/ElemontCapital)

**Standards Compliance:**
- [EIP-55](https://eips.ethereum.org/EIPS/eip-55) - Ethereum address checksums
- [Uniswap Token Lists](https://tokenlists.org/) - Token metadata standard
- [JSON Schema Draft-07](https://json-schema.org/) - Validation schemas

---

**Maintained with ❤️ by the VinuChain Community**

For questions or support, please [open an issue](../../issues/new/choose).
