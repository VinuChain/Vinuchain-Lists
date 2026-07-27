/**
 * Configuration constants for VinuChain Lists validation
  */

module.exports = {
  // File size limits
  MAX_FILE_SIZE: 100 * 1024, // 100KB
  MAX_SOLIDITY_FILE_SIZE: 500 * 1024, // 500KB for Solidity files

  // Address validation
  ADDRESS_LENGTH: 42, // 0x + 40 hex characters
  ADDRESS_PATTERN: /^0x[a-fA-F0-9]{40}$/,

  // Token validation
  MIN_DECIMALS: 0,
  MAX_DECIMALS: 77, // uint256 safe maximum
  RECOMMENDED_MAX_DECIMALS: 18, // Warn if higher
  SYMBOL_MIN_LENGTH: 1,
  SYMBOL_MAX_LENGTH: 20,
  NAME_MIN_LENGTH: 1,
  NAME_MAX_LENGTH: 100,

  // DoS bounds for whole-repo validation.
  // These are generous safety ceilings on how many entries validate.js will
  // process in a single run — NOT a per-submission batch limit. The registry
  // validates the entire tokens/ and contracts/ tree every run, so these must
  // comfortably exceed the real registry size with headroom for organic growth.
  MAX_TOKENS: 500,
  MAX_PROJECTS: 100,
  MAX_CONTRACTS_PER_PROJECT: 100,
  MAX_RED_FLAGS: 10,

  // Recognised VinuChain network IDs. 206 = testnet, 207 = mainnet.
  // Mirrors the chain-ID guard in scripts/update-vns-oracle.js (which also
  // recognises 205 = staging) but the registry only lists production-relevant
  // testnet/mainnet entries.
  VALID_CHAIN_IDS: [206, 207],
  MAINNET_CHAIN_ID: 207,
  TESTNET_CHAIN_ID: 206,

  // Default public read-only RPC endpoints per chainId, used by the on-chain
  // validator. Overridable via env (VINUCHAIN_MAINNET_RPC_URL /
  // VINUCHAIN_TESTNET_RPC_URL) to point at private/archive nodes in CI.
  RPC_URLS_BY_CHAIN_ID: {
    207: 'https://rpc.vinuchain.org',
    206: 'https://vinufoundation-rpc.com',
  },

  // URL validation
  MAX_URL_LENGTH: 500,
  URL_HTTPS_PATTERN: /^https:\/\/[^\s]+$/,

  // SSRF Protection - Blocked hosts
  BLOCKED_HOSTS: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal', // GCP metadata
    'metadata', // Generic metadata
    '169.254.169.253', // Azure metadata (old)
  ],

  // SSRF Protection - Blocked IP patterns
  BLOCKED_IP_PATTERNS: [
    /^10\./,  // Private IP range 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private IP range 172.16.0.0/12
    /^192\.168\./,  // Private IP range 192.168.0.0/16
    /^127\./,  // Loopback
    /^0\./,  // "This" network
    /^169\.254\./,  // Link-local
    /^::1$/,  // IPv6 loopback
    /^fe80:/,  // IPv6 link-local
    /^fc00:/,  // IPv6 unique local fc00::/8
    /^fd00:/,  // IPv6 unique local fd00::/8
  ],

  // Email validation
  DISPOSABLE_EMAIL_DOMAINS: [
    'tempmail.com',
    'guerrillamail.com',
    '10minutemail.com',
    'mailinator.com',
    'throwaway.email',
    'temp-mail.org',
    'sharklasers.com',
    'guerrillamail.info',
    'grr.la',
    'maildrop.cc',
  ],

  RESERVED_EMAIL_DOMAINS: [
    'localhost',
    'example.com',
    'example.org',
    'example.net',
    'test.com',
    'invalid',
  ],

  // Contract validation
  SAFE_CONTRACT_NAME_PATTERN: /^[A-Z][a-zA-Z0-9]*$/, // PascalCase only (addresses CRITICAL-01)

  // Solidity validation
  DANGEROUS_SOLIDITY_PATTERNS: {
    selfdestruct: /selfdestruct\s*\(/,
    suicide: /suicide\s*\(/,
    delegatecall: /delegatecall\s*\(/,
    txOrigin: /tx\.origin/,
    blockhash: /blockhash\s*\(/,
    callcode: /callcode\s*\(/,
  },

  // ABI validation
  VALID_ABI_TYPES: ['function', 'constructor', 'event', 'fallback', 'receive', 'error'],
  VALID_STATE_MUTABILITY: ['pure', 'view', 'nonpayable', 'payable'],
  ABI_FUNCTION_NAME_PATTERN: /^[a-zA-Z_][a-zA-Z0-9_]*$/,

  // Terminal colors
  COLORS: {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    YELLOW: '\x1b[33m',
    GREEN: '\x1b[32m',
    BLUE: '\x1b[34m',
    CYAN: '\x1b[36m',
    MAGENTA: '\x1b[35m',
  },

  // Log levels
  LOG_LEVELS: {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    SUCCESS: 'success',
    DEBUG: 'debug',
  },

  // Exit codes
  EXIT_CODES: {
    SUCCESS: 0,
    VALIDATION_ERROR: 1,
    FATAL_ERROR: 2,
  },
};
