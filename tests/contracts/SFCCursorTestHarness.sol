// SPDX-License-Identifier: MIT
pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

// Test-only harness for the SFC reward-cursor initialization fix in
// contracts/vinuchain/SFC.sol::_rawDelegate.
//
// This file is NEVER deployed to any chain. It imports the production SFC
// source so the harness inherits the *real* _rawDelegate (including the fix
// under test) and exposes the minimal set of test hooks needed to:
//   1. prove a fresh delegation seeds stashedRewardsUntilEpoch =
//      currentSealedEpoch (not 0),
//   2. prove claimRewards succeeds (no "zero rewards") for a non-genesis
//      delegator once rewards accrue, and
//   3. prove an existing delegation's cursor is NOT clobbered by a
//      re-delegation.
//
// It deliberately does NOT re-run the full epoch-sealing accounting: it writes
// accumulatedRewardPerToken (ARPT) snapshots directly via a test setter so the
// reward math (_newRewardsOf) integrates a non-zero range above the validator's
// createdEpoch — exactly the dead-zone-vs-live-zone split that the bug stranded.
import "../../contracts/vinuchain/SFC.sol";

// Minimal mock for the `node` (NodeDriverAuth) external dependency. SFC only
// ever calls these three selectors on `node`; Solidity external calls resolve
// purely by address+selector, so a contract implementing just these is a
// drop-in for tests.
contract MockNodeDriver {
    function updateValidatorWeight(uint256, uint256) external {}
    function updateValidatorPubkey(uint256, bytes calldata) external {}
    function incBalance(address, uint256) external {}
}

contract SFCCursorTestHarness is SFC {
    // Allow the harness to receive native VC so claimRewards()'s
    // delegator.call.value(...) payout can succeed in a plain test EVM (on the
    // real chain `node.incBalance` mints this balance into the SFC account).
    function() external payable {}

    function fund() external payable {}

    // The production SFC constructor locks the implementation
    // (initialized = true) so the bare contract can never be initialize()'d —
    // it is meant to live behind a proxy. For a unit test we instead write the
    // minimal initialized state directly, bypassing the locked initializer.
    // This mirrors exactly what SFC.initialize(...) sets for the fields the
    // delegate/claim path under test reads.
    function testSetup(uint256 sealedEpoch, address nodeDriver) external {
        // _reentrancyGuardCounter is private in SFC and starts at 0; nonReentrant
        // accepts 0 (<2) and normalises it to 1, so no init is needed here.
        currentSealedEpoch = sealedEpoch;
        node = NodeDriverAuth(nodeDriver);
        totalSupply = 1000000 ether;
        baseRewardPerSecond = 0.93 * 1e18;
        getEpochSnapshot[sealedEpoch].endTime = block.timestamp;
        // stakes[0] is the genesis sentinel pushed by the real initialize();
        // stakePosition==0 means "no entry", so index 0 must stay reserved.
        stakes.push(
            StakeWithoutAmount({
                delegator: address(0),
                validatorId: 0,
                timestamp: 0
            })
        );
    }

    // --- test-only state setters -------------------------------------------

    // Move the sealed-epoch pointer forward without running sealEpoch().
    function setCurrentSealedEpoch(uint256 epoch) external {
        currentSealedEpoch = epoch;
    }

    // Seed the accumulated-reward-per-token snapshot for (epoch, validator).
    // ARPT is monotonic non-decreasing in production; the dead zone below a
    // non-genesis validator's createdEpoch is all-zero, which is the crux of
    // the stranded-cursor bug.
    function setEpochARPT(
        uint256 epoch,
        uint256 validatorID,
        uint256 arpt
    ) external {
        getEpochSnapshot[epoch].accumulatedRewardPerToken[validatorID] = arpt;
        if (getEpochSnapshot[epoch].endTime == 0) {
            getEpochSnapshot[epoch].endTime = block.timestamp;
        }
    }

    // Register a validator created at a post-genesis epoch (mirrors a real
    // validator that joined after chain start).
    function createValidatorAt(
        address auth,
        uint256 validatorID,
        uint256 createdEpoch
    ) external {
        bytes memory pubkey = new bytes(66);
        pubkey[0] = 0xc0;
        // make the pubkey unique per validator so usedPubkeyHash doesn't collide
        pubkey[1] = byte(uint8(validatorID));
        _rawCreateValidator(
            auth,
            validatorID,
            pubkey,
            OK_STATUS,
            createdEpoch,
            block.timestamp, // createdTime != 0 => validator "exists"
            0,
            0
        );
        if (validatorID > lastValidatorID) {
            lastValidatorID = validatorID;
        }
    }

    // Drive a delegation through the real production path under test.
    function delegate(
        address delegator,
        uint256 toValidatorID,
        uint256 amount
    ) external {
        _rawDelegate(delegator, toValidatorID, amount);
    }

    // --- test-only readers --------------------------------------------------

    function cursor(address delegator, uint256 toValidatorID)
        external
        view
        returns (uint256)
    {
        return stashedRewardsUntilEpoch[delegator][toValidatorID];
    }

    function stakeOf(address delegator, uint256 toValidatorID)
        external
        view
        returns (uint256)
    {
        return getStake[delegator][toValidatorID];
    }

    // Force-set a cursor to emulate a delegation that already carries history,
    // so we can prove the guard does NOT clobber it on re-delegation.
    function forceCursor(
        address delegator,
        uint256 toValidatorID,
        uint256 value
    ) external {
        stashedRewardsUntilEpoch[delegator][toValidatorID] = value;
    }

    // --- self-service reactivation test hooks ------------------------------

    // Directly set a validator's deactivation state (simulates an offline or
    // doublesign deactivation without running the epoch-seal machinery).
    function deactivate(
        uint256 validatorID,
        uint256 status,
        uint256 deactivatedEpoch,
        uint256 deactivatedTime
    ) external {
        getValidator[validatorID].status = status;
        getValidator[validatorID].deactivatedEpoch = deactivatedEpoch;
        getValidator[validatorID].deactivatedTime = deactivatedTime;
    }

    // Set the offline-penalty threshold used as the self-reactivation cooldown.
    function setOfflinePenaltyThresholdTime(uint256 t) external {
        offlinePenaltyThresholdTime = t;
    }

    // Mark an epoch's rate as owner-corrected (so _getEffectiveRewardRate returns the
    // corrected value), to exercise the heal-floor-honors-correction path.
    function setCorrected(uint256 epoch, uint256 validatorID, uint256 rate) external {
        isEpochCorrected[epoch][validatorID] = true;
        correctedEpochRewardRate[epoch][validatorID] = rate;
    }

    // Directly set a delegator's stake to a validator (e.g. 0 to simulate a full exit that
    // leaves the reward cursor at its last value), to exercise the seed/monotonic-cursor paths.
    function forceStake(
        address delegator,
        uint256 toValidatorID,
        uint256 amount
    ) external {
        getStake[delegator][toValidatorID] = amount;
    }

    // Set self-stake and received-stake so reactivateValidator's minSelfStake /
    // delegated-limit pre-conditions can be satisfied in a unit test.
    function setStakes(
        uint256 validatorID,
        address auth,
        uint256 selfStake,
        uint256 receivedStake
    ) external {
        getStake[auth][validatorID] = selfStake;
        getValidator[validatorID].receivedStake = receivedStake;
    }

    // Expose the internal reward-rate read-through so a test can prove a gap
    // epoch reads the healed floor R rather than a raw 0.
    function effectiveRate(uint256 epoch, uint256 validatorID)
        external
        view
        returns (uint256)
    {
        return _getEffectiveRewardRate(epoch, validatorID);
    }

    // Expose the internal safe-cursor scan so a test can prove the cursor
    // advances past a healed gap instead of being pinned at the R->0 drop.
    function safeCursor(
        address delegator,
        uint256 validatorID,
        uint256 payableEpoch
    ) external view returns (uint256) {
        return _safeCursorPosition(delegator, validatorID, payableEpoch);
    }
}
