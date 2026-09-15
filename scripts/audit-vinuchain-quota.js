#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const TESTNET_CHAIN_ID = 206n;
const TESTNET_RPC = process.env.TESTNET_RPC || 'https://testnet-rpc.vinuchain.org';
const EXPLORER_API =
  process.env.TESTNET_EXPLORER_API || 'https://testnet.vinuexplorer.org/api/v2';
const QUOTA_PROXY = '0x824B93dE7221cf8a35FBd29d5202f6eFa3A29C5D';
const PROXY_ADMIN = '0xcE154534e1E8F4Cc9Ab642Ad1816Ee1A237055F4';
const PROXY_ADMIN_OWNER = '0x07B4eF04b62E69aE14A715cdcae692fa7033b9a5';
const STAKE_FOR_SELECTOR = '4bf69206';

const proxyAdminAbi = [
  'function owner() view returns (address)',
  'function getProxyImplementation(address proxy) view returns (address)',
];

function requireFlag(name) {
  return ['1', 'true', 'yes'].includes(
    String(process.env[name] || '').toLowerCase()
  );
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'));
}

function getContract(info, name) {
  const contract = info.contracts.find((entry) => entry.name === name);
  if (!contract) {
    throw new Error(`Missing ${name} entry in contracts/vinuchain/info.json`);
  }
  return contract;
}

function findContract(info, name) {
  return info.contracts.find((entry) => entry.name === name);
}

function abiHasPayableStakeFor(abi) {
  return abi.some(
    (entry) =>
      entry.type === 'function' &&
      entry.name === 'stakeFor' &&
      entry.stateMutability === 'payable' &&
      entry.inputs?.length === 1 &&
      entry.inputs[0]?.type === 'address'
  );
}

function abiSignature(entry) {
  const inputs = (entry.inputs || [])
    .map((input) => `${input.indexed ? 'indexed ' : ''}${input.type}`)
    .join(',');
  const outputs = (entry.outputs || []).map((output) => output.type).join(',');
  return `${entry.type}:${entry.name || ''}(${inputs})=>(${outputs})/${
    entry.stateMutability || ''
  }`;
}

function abiSignatures(abi) {
  return abi.map(abiSignature).sort();
}

function abisMatch(left, right) {
  return JSON.stringify(abiSignatures(left)) === JSON.stringify(abiSignatures(right));
}

async function getExplorerContract(implementation) {
  const response = await fetch(`${EXPLORER_API}/smart-contracts/${implementation}`);
  if (!response.ok) {
    throw new Error(
      `VinuExplorer returned HTTP ${response.status} for ${implementation}`
    );
  }
  return response.json();
}

async function main() {
  const info = readJson('contracts/vinuchain/info.json');
  const abi = readJson('contracts/vinuchain/QuotaContract_abi.json');
  const source = fs.readFileSync(
    path.join(process.cwd(), 'contracts/vinuchain/QuotaContract.sol'),
    'utf8'
  );
  const proxyEntry = getContract(info, 'OptimizedTransparentUpgradeableProxy');
  const implementationEntry = getContract(info, 'QuotaContract');
  const receiverImplementationEntry = findContract(
    info,
    'QuotaContractReceiverImplementation'
  );
  const provider = new ethers.JsonRpcProvider(TESTNET_RPC);
  const proxyAdmin = new ethers.Contract(PROXY_ADMIN, proxyAdminAbi, provider);

  const [network, block, proxyCode, adminCode, proxyAdminOwner, liveImplementation] =
    await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.getCode(QUOTA_PROXY),
      provider.getCode(PROXY_ADMIN),
      proxyAdmin.owner(),
      proxyAdmin.getProxyImplementation(QUOTA_PROXY),
    ]);

  if (network.chainId !== TESTNET_CHAIN_ID) {
    throw new Error(`Unexpected chain ${network.chainId}; expected ${TESTNET_CHAIN_ID}`);
  }
  if (proxyCode === '0x') {
    throw new Error(`Quota proxy ${QUOTA_PROXY} has no code`);
  }
  if (adminCode === '0x') {
    throw new Error(`ProxyAdmin ${PROXY_ADMIN} has no code`);
  }
  if (proxyAdminOwner !== PROXY_ADMIN_OWNER) {
    throw new Error(
      `Unexpected ProxyAdmin owner ${proxyAdminOwner}; expected ${PROXY_ADMIN_OWNER}`
    );
  }

  const implementationCode = await provider.getCode(liveImplementation);
  const explorer = await getExplorerContract(liveImplementation);
  const liveImplementationHasStakeForSelector = implementationCode
    .toLowerCase()
    .includes(STAKE_FOR_SELECTOR);
  let receiverImplementation;
  let receiverImplementationHasStakeForSelector;
  let receiverExplorerName;
  let receiverExplorerVerified;
  let receiverExplorerFullyVerified;
  let receiverExplorerPartiallyVerified;
  let receiverExplorerChangedBytecode;
  let receiverExplorerAbiHasStakeFor;
  let receiverExplorerAbiMatchesList;
  if (receiverImplementationEntry) {
    receiverImplementation = ethers.getAddress(receiverImplementationEntry.address);
    const receiverImplementationCode = await provider.getCode(receiverImplementation);
    const receiverExplorer = await getExplorerContract(receiverImplementation);
    receiverImplementationHasStakeForSelector = receiverImplementationCode
      .toLowerCase()
      .includes(STAKE_FOR_SELECTOR);
    receiverExplorerName = receiverExplorer.name || null;
    receiverExplorerVerified = Boolean(receiverExplorer.is_verified);
    receiverExplorerFullyVerified = Boolean(receiverExplorer.is_fully_verified);
    receiverExplorerPartiallyVerified = Boolean(receiverExplorer.is_partially_verified);
    receiverExplorerChangedBytecode = Boolean(receiverExplorer.is_changed_bytecode);
    receiverExplorerAbiHasStakeFor = abiHasPayableStakeFor(receiverExplorer.abi || []);
    receiverExplorerAbiMatchesList = abisMatch(abi, receiverExplorer.abi || []);
  }
  const abiHasStakeFor = abiHasPayableStakeFor(abi);
  const sourceHasStakeFor = source.includes('function stakeFor(address');
  const result = {
    rpc: TESTNET_RPC,
    explorerApi: EXPLORER_API,
    chainId: Number(network.chainId),
    block,
    expectedProxy: QUOTA_PROXY,
    infoProxy: proxyEntry.address,
    infoImplementation: implementationEntry.address,
    liveImplementation,
    receiverImplementation,
    proxyMatchesInfo:
      ethers.getAddress(proxyEntry.address) === ethers.getAddress(QUOTA_PROXY),
    implementationMatchesLive:
      ethers.getAddress(implementationEntry.address) ===
      ethers.getAddress(liveImplementation),
    liveImplementationHasStakeForSelector,
    receiverImplementationHasStakeForSelector,
    abiHasStakeFor,
    sourceHasStakeFor,
    explorerName: explorer.name || null,
    explorerVerified: Boolean(explorer.is_verified),
    explorerFullyVerified: Boolean(explorer.is_fully_verified),
    explorerPartiallyVerified: Boolean(explorer.is_partially_verified),
    explorerChangedBytecode: Boolean(explorer.is_changed_bytecode),
    explorerAbiHasStakeFor: abiHasPayableStakeFor(explorer.abi || []),
    explorerAbiMatchesList:
      liveImplementationHasStakeForSelector && explorer.abi
        ? abisMatch(abi, explorer.abi)
        : null,
    receiverExplorerName,
    receiverExplorerVerified,
    receiverExplorerFullyVerified,
    receiverExplorerPartiallyVerified,
    receiverExplorerChangedBytecode,
    receiverExplorerAbiHasStakeFor,
    receiverExplorerAbiMatchesList,
  };

  const strict = requireFlag('REQUIRE_QUOTA_LISTS_CURRENT');
  if (strict) {
    const failures = [];
    if (!result.proxyMatchesInfo) {
      failures.push('proxy address in info.json does not match live target');
    }
    if (!result.implementationMatchesLive) {
      failures.push('implementation address in info.json does not match live proxy');
    }
    if (!result.liveImplementationHasStakeForSelector) {
      failures.push('live implementation does not contain stakeFor selector');
    }
    if (!result.abiHasStakeFor) {
      failures.push('QuotaContract ABI does not include stakeFor');
    }
    if (!result.sourceHasStakeFor) {
      failures.push('QuotaContract source does not include stakeFor');
    }
    if (!result.explorerVerified) {
      failures.push('live implementation is not verified on VinuExplorer');
    }
    if (!result.explorerFullyVerified) {
      failures.push('live implementation is not fully verified on VinuExplorer');
    }
    if (result.explorerPartiallyVerified) {
      failures.push('live implementation is only partially verified on VinuExplorer');
    }
    if (result.explorerChangedBytecode) {
      failures.push('VinuExplorer reports changed bytecode');
    }
    if (
      result.liveImplementationHasStakeForSelector &&
      !result.explorerAbiHasStakeFor
    ) {
      failures.push('live VinuExplorer ABI does not include payable stakeFor');
    }
    if (
      result.liveImplementationHasStakeForSelector &&
      result.explorerAbiMatchesList !== true
    ) {
      failures.push('live VinuExplorer ABI does not match checked-in ABI');
    }
    if (receiverImplementationEntry) {
      if (!result.receiverImplementationHasStakeForSelector) {
        failures.push(
          'receiver implementation entry does not contain stakeFor selector'
        );
      }
      if (!result.receiverExplorerVerified) {
        failures.push('receiver implementation entry is not verified on VinuExplorer');
      }
      if (!result.receiverExplorerFullyVerified) {
        failures.push(
          'receiver implementation entry is not fully verified on VinuExplorer'
        );
      }
      if (result.receiverExplorerPartiallyVerified) {
        failures.push(
          'receiver implementation entry is only partially verified on VinuExplorer'
        );
      }
      if (result.receiverExplorerChangedBytecode) {
        failures.push(
          'VinuExplorer reports changed bytecode for receiver implementation entry'
        );
      }
      if (!result.receiverExplorerAbiHasStakeFor) {
        failures.push(
          'receiver VinuExplorer ABI does not include payable stakeFor'
        );
      }
      if (result.receiverExplorerAbiMatchesList !== true) {
        failures.push('receiver VinuExplorer ABI does not match checked-in ABI');
      }
    }
    if (failures.length > 0) {
      console.log(JSON.stringify(result, null, 2));
      throw new Error(`Quota list audit failed: ${failures.join('; ')}`);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
