#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const TESTNET_CHAIN_ID = 206n;
const TESTNET_RPC = process.env.TESTNET_RPC || "https://vinufoundation-rpc.com";
const INFO_PATH = path.join(process.cwd(), "contracts/vinuchain/info.json");
const CORRECTED_PAYBACK_V2 = "0x89D1cBD9DEAaB4dFf6f800a336FBDd9A5c6829e4";
const KNOWN_BUG_PAYBACK_V2 = "0xdEA4687FDBA2528d1b30222e199c90b63AF8c850";
const STALE_RECEIVER_IMPLEMENTATION =
  "0x80DA5f5e78c94EE5125Be515Ad4cd248469B57ba";

const quotaV2Abi = [
  "function owner() view returns (address)",
  "function feeRefundBlockCount() view returns (uint256)",
  "function minStake() view returns (uint256)",
  "function quotaFactor() view returns (uint256)",
  "function holdTime() view returns (uint256)",
  "function getFundedStake(address,address) view returns (uint256)",
  "function getWithdrawalRequestDelegator(address,uint256) view returns (address)",
  "function stakeFor(address) payable",
  "function unstakeFor(address,uint256)",
];

function hasFlag(name) {
  return process.argv.includes(name);
}

function readInfo() {
  return JSON.parse(fs.readFileSync(INFO_PATH, "utf8"));
}

function writeInfo(info) {
  fs.writeFileSync(INFO_PATH, `${JSON.stringify(info, null, 2)}\n`);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const provider = new ethers.JsonRpcProvider(TESTNET_RPC);
  const contract = new ethers.Contract(
    CORRECTED_PAYBACK_V2,
    quotaV2Abi,
    provider,
  );

  const [
    network,
    code,
    owner,
    feeRefundBlockCount,
    minStake,
    quotaFactor,
    holdTime,
  ] = await Promise.all([
    provider.getNetwork(),
    provider.getCode(CORRECTED_PAYBACK_V2),
    contract.owner(),
    contract.feeRefundBlockCount(),
    contract.minStake(),
    contract.quotaFactor(),
    contract.holdTime(),
  ]);

  if (network.chainId !== TESTNET_CHAIN_ID) {
    throw new Error(
      `Unexpected chain ${network.chainId}; expected ${TESTNET_CHAIN_ID}`,
    );
  }
  if (code === "0x") {
    throw new Error(`No code at corrected PaybackV2 ${CORRECTED_PAYBACK_V2}`);
  }

  const info = readInfo();
  info.contracts = info.contracts.filter((entry) => {
    const address = String(entry.address || "").toLowerCase();
    return (
      entry.name !== "QuotaContractReceiverImplementation" &&
      address !== KNOWN_BUG_PAYBACK_V2.toLowerCase() &&
      address !== STALE_RECEIVER_IMPLEMENTATION.toLowerCase()
    );
  });

  for (const entry of info.contracts) {
    if (entry.name === "OptimizedTransparentUpgradeableProxy") {
      entry.description =
        "Legacy testnet Quota/Payback EIP-1967 proxy kept for historical transactions. PaybackV2 switched active quota accounting to the non-proxy QuotaContractV2 entry on 2026-05-16.";
    }
    if (entry.name === "QuotaContract") {
      entry.description =
        "Historical verified pre-PaybackV2 Quota/Payback implementation behind the legacy testnet proxy. Active testnet payback now uses QuotaContractV2.";
    }
  }

  const paybackV2Entry = {
    name: "QuotaContractV2",
    artifact: "QuotaContractV2",
    address: CORRECTED_PAYBACK_V2,
    type: "staking",
    description:
      "Active testnet PaybackV2 non-proxy contract. stakeFor(address) credits receiver refunds; funding wallet owns/withdraws stake via unstakeFor(address,uint256). Deployed 2026-05-16.",
  };
  const existingIndex = info.contracts.findIndex(
    (entry) => entry.name === "QuotaContractV2",
  );
  if (existingIndex >= 0) {
    info.contracts[existingIndex] = paybackV2Entry;
  } else {
    const quotaIndex = info.contracts.findIndex(
      (entry) => entry.name === "QuotaContract",
    );
    info.contracts.splice(
      quotaIndex >= 0 ? quotaIndex + 1 : info.contracts.length,
      0,
      paybackV2Entry,
    );
  }

  const result = {
    rpc: TESTNET_RPC,
    contract: CORRECTED_PAYBACK_V2,
    owner,
    codeBytes: (code.length - 2) / 2,
    feeRefundBlockCount: feeRefundBlockCount.toString(),
    minStake: minStake.toString(),
    quotaFactor: quotaFactor.toString(),
    holdTime: holdTime.toString(),
    dryRun,
  };

  if (!dryRun) {
    writeInfo(info);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
