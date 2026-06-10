#!/usr/bin/env node

/**
 * VinuChain Lists - Unified Validation Script
 * Validates tokens and contracts in the vinuchain-lists repository
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Import utility modules
const {
  MAX_TOKENS,
  MAX_PROJECTS,
  MAX_CONTRACTS_PER_PROJECT,
  RECOMMENDED_MAX_DECIMALS,
  EXIT_CODES,
} = require('./utils/constants');

const { safeReadJSON, loadSchema } = require('./utils/safe-json');

const {
  validateTokenAddress,
  validateEIP55Checksum,
  validateAddressDirectory,
} = require('./utils/address-validator');

const { validateURLs } = require('./utils/url-validator');

const {
  validateContractName,
  safePathJoin,
  safeReadFile,
  safeReadDir,
  isDirectory,
} = require('./utils/file-utils');

const { validateEmail } = require('./validators/email-validator');
const { validateABI } = require('./validators/abi-validator');
const { validateSolidityFile } = require('./validators/solidity-validator');
const { validateLogo } = require('./validators/logo-validator');

const logger = require('./utils/logger');

// Initialize AJV with schemas
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Load schemas with error handling (addresses QUALITY-09)
const tokenSchema = loadSchema(
  path.join(__dirname, '../schemas/token.schema.json'),
  'Token Schema'
);
const contractSchema = loadSchema(
  path.join(__dirname, '../schemas/contract.schema.json'),
  'Contract Schema'
);

const validateTokenSchema = ajv.compile(tokenSchema);
const validateContractSchema = ajv.compile(contractSchema);

// Track all addresses to detect duplicates. Keys are `${chainId}:${address}`
// so the same EVM address legitimately deployed on both testnet (206) and
// mainnet (207) is not a false-positive duplicate, and cross-references can
// never match an entry from the wrong chain.
const allAddresses = new Set();
const tokenAddresses = new Map(); // "chainId:address" -> token data (addresses QUALITY-05)
const contractAddresses = new Map(); // "chainId:address" -> {project, contract}

function chainAddressKey(chainId, address) {
  return `${chainId}:${address}`;
}

// Track token symbols/names per chain to detect impersonation collisions
// (addresses AUD-06). Keyed by `${chainId}:${SYMBOL}` so the same symbol on
// testnet and mainnet is allowed, but two different mainnet addresses both
// claiming "USDT" is a hard error unless explicitly allowlisted.
const tokenSymbolsByChain = new Map(); // "chainId:SYMBOL" -> address
const tokenNamesByChain = new Map(); // "chainId:name" (lowercased) -> address

// Load the collision allowlist (legitimate same-symbol/same-chain duplicates,
// e.g. a token migration with both versions briefly listed). Absent file = no
// allowlisted collisions.
function loadCollisionAllowlist() {
  const allowlistPath = path.join(__dirname, '../tokens/symbol-collisions.allowlist.json');
  if (!fs.existsSync(allowlistPath)) {
    return { symbols: new Set(), names: new Set() };
  }
  try {
    const data = safeReadJSON(allowlistPath);
    return {
      symbols: new Set((data.symbols || []).map(s => String(s))),
      names: new Set((data.names || []).map(s => String(s))),
    };
  } catch (e) {
    logger.warn(`Could not read symbol-collisions allowlist: ${e.message}`);
    return { symbols: new Set(), names: new Set() };
  }
}

const collisionAllowlist = loadCollisionAllowlist();

/**
 * Validate all tokens in the repository
 * @param {string} tokensDir - Path to tokens directory
 * @returns {number} Number of valid tokens found
 */
function validateTokens(tokensDir) {
  logger.section('Validating Tokens');

  if (!fs.existsSync(tokensDir)) {
    logger.warn('Tokens directory not found');
    return 0;
  }

  // Read directory safely
  const dirResult = safeReadDir(tokensDir);
  if (!dirResult.success) {
    logger.error(`Failed to read tokens directory: ${dirResult.error}`);
    return 0;
  }

  // Filter for address directories (addresses CRITICAL-02)
  const tokenDirs = dirResult.entries.filter(f => {
    const fullPath = path.join(tokensDir, f);
    if (!isDirectory(fullPath)) return false;

    // Validate directory name is safe address format
    const validation = validateAddressDirectory(f, tokensDir);
    if (!validation.valid) {
      logger.error(validation.error);
      return false;
    }

    return true;
  });

  // DoS bound on whole-repo validation (addresses MEDIUM-03).
  // This guards against an attacker committing thousands of token directories,
  // not against legitimate batch size — validate.js always validates the entire
  // tree. If this fires, the registry has grown past its safety ceiling and the
  // bound in scripts/utils/constants.js should be raised deliberately.
  if (tokenDirs.length > MAX_TOKENS) {
    logger.error(
      `Token count ${tokenDirs.length} exceeds the validation safety ceiling ` +
      `(MAX_TOKENS=${MAX_TOKENS}). This is a DoS bound on whole-repo validation, ` +
      'not a per-PR limit; raise MAX_TOKENS in scripts/utils/constants.js if the ' +
      'registry has legitimately grown this large.'
    );
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  let tokenCount = 0;

  for (const addressDir of tokenDirs) {
    // Construct path safely (addresses CRITICAL-02)
    const pathResult = safePathJoin(tokensDir, addressDir, `${addressDir}.json`);
    if (!pathResult.valid) {
      logger.error(pathResult.error);
      continue;
    }

    const tokenPath = pathResult.path;

    // Read and parse JSON safely (addresses CRITICAL-03, HIGH-03)
    let tokenData;
    try {
      tokenData = safeReadJSON(tokenPath);
    } catch (e) {
      logger.error(`Failed to read ${addressDir}.json: ${e.message}`);
      continue;
    }

    // Validate against schema
    if (!validateTokenSchema(tokenData)) {
      logger.error(`Schema validation failed for ${addressDir}.json`);
      validateTokenSchema.errors.forEach(err => {
        logger.error(`  ${err.instancePath} ${err.message}`);
      });
      continue;
    }

    // Comprehensive address validation (addresses CRITICAL-02, QUALITY-02)
    const addressValidation = validateTokenAddress(
      tokenData.address,
      addressDir,
      tokenData.symbol
    );
    if (!addressValidation.valid) {
      logger.error(addressValidation.error);
      continue;
    }

    // Validate URLs with SSRF protection (addresses HIGH-01, HIGH-02)
    // Note: 'support' is email field, not URL, so excluded from this check
    const urlFields = ['logoURI', 'website', 'github', 'twitter', 'telegram', 'discord', 'coingecko', 'coinmarketcap'];
    const urlValidation = validateURLs(tokenData, urlFields);
    if (!urlValidation.valid) {
      urlValidation.errors.forEach(err => logger.error(`  ${err}`));
      continue;
    }

    // Validate email domains (addresses MEDIUM-05)
    if (tokenData.support && /@/.test(tokenData.support)) {
      const emailValidation = validateEmail(tokenData.support, 'support email');
      if (!emailValidation.valid) {
        logger.error(`  ${emailValidation.error}`);
        continue;
      }
      if (emailValidation.warnings) {
        emailValidation.warnings.forEach(w => logger.warn(`  ${w}`));
      }
    }

    // Check for unusual decimals (addresses QUALITY-08)
    if (tokenData.decimals > RECOMMENDED_MAX_DECIMALS) {
      logger.warn(
        `  ${tokenData.symbol}: Unusual decimals (${tokenData.decimals}) - verify this is correct`
      );
    }

    // Validate logo file exists and meets requirements
    const tokenDirPath = path.join(tokensDir, addressDir);
    const logoValidation = validateLogo(tokenDirPath, tokenData.address, tokenData.symbol);
    if (!logoValidation.valid) {
      logger.error(`  ${logoValidation.error}`);
      continue;
    }
    if (logoValidation.warnings) {
      logoValidation.warnings.forEach(w => logger.warn(`  ${w}`));
    }

    // Check for duplicate addresses (scoped per chain)
    if (allAddresses.has(chainAddressKey(tokenData.chainId, tokenData.address))) {
      logger.error(`Duplicate address found on chain ${tokenData.chainId}: ${tokenData.address}`);
      continue;
    }

    // Detect symbol/name impersonation collisions on the same chain
    // (addresses AUD-06). Two different addresses claiming the same symbol on
    // the same chain is the classic phishing-substitution vector.
    const symbolKey = `${tokenData.chainId}:${tokenData.symbol.toUpperCase()}`;
    const nameKey = `${tokenData.chainId}:${tokenData.name.toLowerCase()}`;
    if (tokenSymbolsByChain.has(symbolKey) && !collisionAllowlist.symbols.has(symbolKey)) {
      logger.error(
        `Duplicate token symbol "${tokenData.symbol}" on chain ${tokenData.chainId}: ` +
        `${tokenData.address} collides with ${tokenSymbolsByChain.get(symbolKey)}. ` +
        'If this is a legitimate listing, add the key to tokens/symbol-collisions.allowlist.json.'
      );
      continue;
    }
    if (tokenNamesByChain.has(nameKey) && !collisionAllowlist.names.has(nameKey)) {
      logger.error(
        `Duplicate token name "${tokenData.name}" on chain ${tokenData.chainId}: ` +
        `${tokenData.address} collides with ${tokenNamesByChain.get(nameKey)}. ` +
        'If this is a legitimate listing, add the key to tokens/symbol-collisions.allowlist.json.'
      );
      continue;
    }
    tokenSymbolsByChain.set(symbolKey, tokenData.address);
    tokenNamesByChain.set(nameKey, tokenData.address);

    allAddresses.add(chainAddressKey(tokenData.chainId, tokenData.address));
    tokenAddresses.set(chainAddressKey(tokenData.chainId, tokenData.address), tokenData); // Cache for later (addresses QUALITY-05)

    tokenCount++;
    logger.success(`${tokenData.symbol} (${tokenData.name}) - ${addressDir}`);
  }

  logger.info(`\nTotal tokens validated: ${tokenCount}`);
  return tokenCount;
}

/**
 * Validate a single contract within a project
 * @param {Object} contract - Contract object from info.json
 * @param {string} projectSlug - Project directory name
 * @param {string} projectPath - Full path to project directory
 * @returns {boolean} True if contract is valid
 */
function validateContractFiles(contract, projectSlug, projectPath) {
  // Validate contract name for safety (addresses CRITICAL-01)
  const nameValidation = validateContractName(contract.name);
  if (!nameValidation.valid) {
    logger.error(`  ${nameValidation.error}`);
    return false;
  }

  const artifactName = contract.artifact || contract.name;
  const artifactValidation = validateContractName(artifactName);
  if (!artifactValidation.valid) {
    logger.error(`  ${artifactValidation.error}`);
    return false;
  }

  // Validate address checksum
  const addressValidation = validateEIP55Checksum(contract.address, contract.name);
  if (!addressValidation.valid) {
    logger.error(`  ${addressValidation.error}`);
    return false;
  }

  // Token contracts intentionally share the token registry address.
  // Cross-reference validation below verifies the token.project link.
  const contractKey = chainAddressKey(contract.chainId, contract.address);
  const isRegisteredTokenContract = contract.type === 'token' && tokenAddresses.has(contractKey);

  // Check for duplicate addresses (scoped per chain)
  if (allAddresses.has(contractKey) && !isRegisteredTokenContract) {
    logger.error(`  Duplicate address found on chain ${contract.chainId}: ${contract.address} (${contract.name})`);
    return false;
  }

  if (!isRegisteredTokenContract) {
    allAddresses.add(contractKey);
  }
  contractAddresses.set(contractKey, { project: projectSlug, contract: contract.name });

  // Verify contract files exist (using safe path construction - addresses CRITICAL-01)
  const solPathResult = safePathJoin(projectPath, `${artifactName}.sol`);
  const abiPathResult = safePathJoin(projectPath, `${artifactName}_abi.json`);

  if (!solPathResult.valid) {
    logger.error(`  ${solPathResult.error}`);
    return false;
  }

  if (!abiPathResult.valid) {
    logger.error(`  ${abiPathResult.error}`);
    return false;
  }

  const solPath = solPathResult.path;
  const abiPath = abiPathResult.path;

  // Check Solidity file
  const solReadResult = safeReadFile(solPath);
  if (!solReadResult.success) {
    logger.error(`  Missing ${artifactName}.sol: ${solReadResult.error}`);
    return false;
  }

  // Validate Solidity content (addresses MEDIUM-04, MISSING-09)
  const solValidation = validateSolidityFile(solReadResult.content, artifactName);
  if (!solValidation.valid) {
    logger.error(`  ${artifactName}.sol: ${solValidation.error}`);
    return false;
  }

  // Log Solidity warnings
  if (solValidation.warnings && solValidation.warnings.length > 0) {
    solValidation.warnings.forEach(w => logger.warn(`  ${artifactName}.sol: ${w}`));
  }

  // Check ABI file
  const abiReadResult = safeReadFile(abiPath);
  if (!abiReadResult.success) {
    logger.error(`  Missing ${artifactName}_abi.json: ${abiReadResult.error}`);
    return false;
  }

  // Parse and validate ABI (addresses HIGH-04, MISSING-10)
  let abi;
  try {
    abi = safeReadJSON(abiPath);
  } catch (e) {
    logger.error(`  Invalid JSON in ${artifactName}_abi.json: ${e.message}`);
    return false;
  }

  const abiValidation = validateABI(abi, artifactName);
  if (!abiValidation.valid) {
    logger.error(`  ${abiValidation.error}`);
    return false;
  }

  // Log ABI warnings
  if (abiValidation.warnings && abiValidation.warnings.length > 0) {
    abiValidation.warnings.forEach(w => logger.warn(`  ${w}`));
  }

  const artifactSuffix = contract.artifact ? ` [artifact: ${contract.artifact}]` : '';
  logger.success(`  ${contract.type}: ${contract.name} (${contract.address})${artifactSuffix}`);
  return true;
}

/**
 * Validate all contract projects in the repository
 * @param {string} contractsDir - Path to contracts directory
 * @returns {{projectCount: number, contractCount: number}} Validation results
 */
function validateContracts(contractsDir) {
  logger.section('Validating Contracts');

  if (!fs.existsSync(contractsDir)) {
    logger.warn('Contracts directory not found');
    return { projectCount: 0, contractCount: 0 };
  }

  // Read directory safely
  const dirResult = safeReadDir(contractsDir);
  if (!dirResult.success) {
    logger.error(`Failed to read contracts directory: ${dirResult.error}`);
    return { projectCount: 0, contractCount: 0 };
  }

  // Filter for project directories
  const projectDirs = dirResult.entries.filter(f => {
    const fullPath = path.join(contractsDir, f);
    return isDirectory(fullPath);
  });

  // DoS bound on whole-repo validation (addresses MEDIUM-03). See the
  // MAX_TOKENS note above — this is a safety ceiling, not a per-PR batch limit.
  if (projectDirs.length > MAX_PROJECTS) {
    logger.error(
      `Project count ${projectDirs.length} exceeds the validation safety ceiling ` +
      `(MAX_PROJECTS=${MAX_PROJECTS}). Raise MAX_PROJECTS in scripts/utils/constants.js ` +
      'if the registry has legitimately grown this large.'
    );
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  let projectCount = 0;
  let contractCount = 0;

  for (const projectSlug of projectDirs) {
    const projectPath = path.join(contractsDir, projectSlug);
    const infoPath = path.join(projectPath, 'info.json');

    logger.info(`\n  📁 Project: ${projectSlug}`);

    // Read project info file
    let projectData;
    try {
      projectData = safeReadJSON(infoPath);
    } catch (e) {
      logger.error(`  Failed to read info.json: ${e.message}`);
      continue;
    }

    // Validate against schema
    if (!validateContractSchema(projectData)) {
      logger.error(`  Schema validation failed for ${projectSlug}/info.json`);
      validateContractSchema.errors.forEach(err => {
        logger.error(`    ${err.instancePath} ${err.message}`);
      });
      continue;
    }

    // Validate project URLs (addresses HIGH-01, HIGH-02)
    const projectUrlFields = ['website', 'github', 'twitter', 'telegram', 'discord'];
    const urlValidation = validateURLs(projectData, projectUrlFields);
    if (!urlValidation.valid) {
      urlValidation.errors.forEach(err => logger.error(`  ${err}`));
      continue;
    }

    // Validate contact email if present (addresses MEDIUM-05)
    if (projectData.contact) {
      const emailValidation = validateEmail(projectData.contact, 'contact email');
      if (!emailValidation.valid) {
        logger.error(`  ${emailValidation.error}`);
        continue;
      }
      if (emailValidation.warnings) {
        emailValidation.warnings.forEach(w => logger.warn(`  ${w}`));
      }
    }

    // Check contract count rate limit (addresses MEDIUM-03)
    if (projectData.contracts.length > MAX_CONTRACTS_PER_PROJECT) {
      logger.error(
        `  Too many contracts in ${projectSlug}: ${projectData.contracts.length} ` +
        `(max: ${MAX_CONTRACTS_PER_PROJECT})`
      );
      continue;
    }

    // Validate each contract
    let projectValid = true;

    // Check for duplicate contract names within project (addresses LOW-03)
    const contractNames = new Set();
    for (const contract of projectData.contracts) {
      if (contractNames.has(contract.name)) {
        logger.warn(`  Duplicate contract name in ${projectSlug}: ${contract.name} (multiple deployments)`);
      }
      contractNames.add(contract.name);
    }
    for (const contract of projectData.contracts) {
      const contractValid = validateContractFiles(contract, projectSlug, projectPath);
      if (contractValid) {
        contractCount++;
      } else {
        projectValid = false;
      }
    }

    if (projectValid) {
      projectCount++;
    }
  }

  logger.info(`\nTotal projects validated: ${projectCount}`);
  logger.info(`Total contract files validated: ${contractCount}`);

  return { projectCount, contractCount };
}

/**
 * Perform cross-reference validation between tokens and contracts
 * @param {string} contractsDir - Path to contracts directory
 */
function validateCrossReferences(contractsDir) {
  logger.section('Cross-Reference Validation');

  // Check if tokens with "project" field reference valid projects
  for (const [_address, tokenData] of tokenAddresses) {
    if (tokenData.project) {
      const projectPath = path.join(contractsDir, tokenData.project);
      if (!fs.existsSync(projectPath)) {
        logger.error(
          `Token ${tokenData.symbol} references non-existent project: ${tokenData.project}`
        );
      } else {
        logger.success(
          `Token ${tokenData.symbol} correctly references project: ${tokenData.project}`
        );
      }
    }
  }

  // Check if contract addresses that are also tokens have project reference.
  // Both maps are keyed "chainId:address", so the match is chain-exact.
  for (const [key, contractInfo] of contractAddresses) {
    if (tokenAddresses.has(key)) {
      const tokenData = tokenAddresses.get(key);
      const address = key.slice(key.indexOf(':') + 1);

      if (!tokenData.project) {
        logger.error(
          `Token ${tokenData.symbol} (${address}) has a contract in ${contractInfo.project} ` +
          'but missing "project" field'
        );
      } else if (tokenData.project !== contractInfo.project) {
        logger.error(
          `Token ${tokenData.symbol} references project "${tokenData.project}" ` +
          `but contract is in "${contractInfo.project}"`
        );
      }
    }
  }
}

/**
 * Main validation entry point
 */
function main() {
  logger.info('\n🔍 Validating VinuChain Lists Repository\n');
  logger.info('='.repeat(60));

  const tokensDir = path.join(__dirname, '../tokens');
  const contractsDir = path.join(__dirname, '../contracts');

  // Validate tokens
  const tokenCount = validateTokens(tokensDir);

  // Validate contracts
  const { projectCount, contractCount } = validateContracts(contractsDir);

  // Cross-reference validation
  validateCrossReferences(contractsDir);

  // Print summary
  logger.summary();

  const { errors, warnings } = logger.getCounters();

  logger.info('='.repeat(60));
  logger.info('\n📊 Repository Statistics\n');
  logger.info(`Total tokens: ${tokenCount}`);
  logger.info(`Total projects: ${projectCount}`);
  logger.info(`Total contracts: ${contractCount}`);
  logger.info(`Total unique addresses: ${allAddresses.size}`);

  // Exit with appropriate code
  if (errors > 0) {
    logger.error(`\n❌ Validation failed with ${errors} error(s)\n`);
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  } else if (warnings > 0) {
    logger.warn(`\n⚠️  Validation passed with ${warnings} warning(s)\n`);
    process.exit(EXIT_CODES.SUCCESS);
  } else {
    logger.success('\n✅ All validations passed!\n');
    process.exit(EXIT_CODES.SUCCESS);
  }
}

// Run main function
if (require.main === module) {
  try {
    main();
  } catch (e) {
    logger.error(`\nFATAL ERROR: ${e.message}`);
    logger.debug(e.stack);
    process.exit(EXIT_CODES.FATAL_ERROR);
  }
}

module.exports = { validateTokens, validateContracts, validateCrossReferences };
