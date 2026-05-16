const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

const QUOTA_PROXY = "0x824B93dE7221cf8a35FBd29d5202f6eFa3A29C5D";
const PRE_RECEIVER_IMPLEMENTATION =
  "0x0c8735bD6b3E90eaD4cdAB917474Cc6e8E58ce82";
const KNOWN_BUG_PAYBACK_V2 = "0xdEA4687FDBA2528d1b30222e199c90b63AF8c850";
const STALE_RECEIVER_IMPLEMENTATION =
  "0x80DA5f5e78c94EE5125Be515Ad4cd248469B57ba";
const CORRECTED_PAYBACK_V2 = "0x89D1cBD9DEAaB4dFf6f800a336FBDd9A5c6829e4";

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf8"),
  );
}

function readText(relativePath) {
  return fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf8");
}

function getContract(info, name) {
  return info.contracts.find((entry) => entry.name === name);
}

function hasPayableStakeFor(abi) {
  return abi.some(
    (entry) =>
      entry.type === "function" &&
      entry.name === "stakeFor" &&
      entry.stateMutability === "payable" &&
      entry.inputs?.length === 1 &&
      entry.inputs[0]?.type === "address",
  );
}

function hasUnstakeFor(abi) {
  return abi.some(
    (entry) =>
      entry.type === "function" &&
      entry.name === "unstakeFor" &&
      entry.stateMutability === "nonpayable" &&
      entry.inputs?.length === 2 &&
      entry.inputs[0]?.type === "address" &&
      entry.inputs[1]?.type === "uint256",
  );
}

function hasGetFundedStake(abi) {
  return abi.some(
    (entry) =>
      entry.type === "function" &&
      entry.name === "getFundedStake" &&
      entry.stateMutability === "view" &&
      entry.inputs?.length === 2 &&
      entry.inputs[0]?.type === "address" &&
      entry.inputs[1]?.type === "address",
  );
}

function hasGetExternallyFundedStake(abi) {
  return abi.some(
    (entry) =>
      entry.type === "function" &&
      entry.name === "getExternallyFundedStake" &&
      entry.stateMutability === "view" &&
      entry.inputs?.length === 1 &&
      entry.inputs[0]?.type === "address",
  );
}

describe("VinuChain quota registry receiver metadata", () => {
  it("tracks the Quota proxy and receiver-capable ABI/source", () => {
    const info = readJson("contracts/vinuchain/info.json");
    const abi = readJson("contracts/vinuchain/QuotaContract_abi.json");
    const source = readText("contracts/vinuchain/QuotaContract.sol");

    const proxy = getContract(info, "OptimizedTransparentUpgradeableProxy");
    const quota = getContract(info, "QuotaContract");

    expect(proxy.address).to.equal(QUOTA_PROXY);
    expect(proxy.description).to.include("Legacy testnet Quota/Payback");
    expect(quota).to.exist;
    expect(quota.address).to.equal(PRE_RECEIVER_IMPLEMENTATION);
    expect(quota.description).to.include("Historical verified pre-PaybackV2");
    expect(hasPayableStakeFor(abi)).to.equal(true);
    expect(hasUnstakeFor(abi)).to.equal(true);
    expect(hasGetFundedStake(abi)).to.equal(true);
    expect(hasGetExternallyFundedStake(abi)).to.equal(true);
    expect(source).to.include("function stakeFor(address delegator)");
    expect(source).to.include(
      "function unstakeFor(address delegator, uint256 amount)",
    );
    expect(source).to.include("getFundedStake[msg.sender][delegator]");
    expect(source).to.include("getExternallyFundedStake[delegator]");
    expect(source).to.include("require(delegator != address(0)");

    expect(getContract(info, "QuotaContractReceiverImplementation")).to.equal(
      undefined,
    );
    expect(
      info.contracts.find(
        (entry) =>
          entry.address.toLowerCase() ===
          STALE_RECEIVER_IMPLEMENTATION.toLowerCase(),
      ),
    ).to.equal(undefined);
  });

  it("binds the corrected PaybackV2 address to the V2 artifacts only", () => {
    const info = readJson("contracts/vinuchain/info.json");
    const v2Abi = readJson("contracts/vinuchain/QuotaContractV2_abi.json");
    const v2Source = readText("contracts/vinuchain/QuotaContractV2.sol");
    const v2 = getContract(info, "QuotaContractV2");

    expect(
      info.contracts.find(
        (entry) =>
          entry.address.toLowerCase() === KNOWN_BUG_PAYBACK_V2.toLowerCase(),
      ),
    ).to.equal(undefined);
    expect(v2).to.exist;
    expect(v2.address).to.equal(CORRECTED_PAYBACK_V2);
    expect(v2.artifact).to.equal("QuotaContractV2");
    expect(v2.description).to.include("Active testnet PaybackV2");
    expect(v2.description).to.include("unstakeFor(address,uint256)");
    expect(hasPayableStakeFor(v2Abi)).to.equal(true);
    expect(hasUnstakeFor(v2Abi)).to.equal(true);
    expect(hasGetFundedStake(v2Abi)).to.equal(true);
    expect(v2Source).to.include(
      "function unstakeFor(address delegator, uint256 amount)",
    );
    expect(v2Source).to.include("getFundedStake[msg.sender][delegator]");
  });
});
