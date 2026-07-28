/**
 * Behavioural test for full self-service reactivateValidator in
 * contracts/vinuchain/SFC.sol (SfcV2Patch8 / Cycle-163).
 *
 * What changed:
 *   reactivateValidator dropped `onlyOwner` for a `nonReentrant` owner-OR-self
 *   gate: a validator's own (immutable) auth key may reactivate it from a
 *   pure-OFFLINE status after an anti-flap cooldown (offlinePenaltyThresholdTime).
 *   Doublesign/cheater validators (CHEATER_MASK) remain un-reactivatable for
 *   ALL callers. To keep delegators from being frozen across the offline gap,
 *   two appended mappings (reactivationHealFloor, reactivationHealFrom) capture
 *   the pre-gap reward rate R at reactivation, and _getEffectiveRewardRate /
 *   _sealEpoch_rewards carry R forward across the gap so the monotonic reward
 *   index never inverts and no owner correction is needed.
 *
 * This test deploys the real (modified) SFC via the SFCCursorTestHarness
 * subclass compiled with solc 0.5.17 and proves:
 *   GATE:   self (auth) can reactivate an OFFLINE validator; a non-auth caller
 *           is rejected; a DOUBLESIGN validator is rejected; the cooldown is
 *           enforced.
 *   CAPTURE: a successful reactivation sets healFloor = ARPT[deactivatedEpoch]
 *           and healFrom = deactivatedEpoch + 1.
 *   HEAL:   a gap epoch reads the healed floor R (not raw 0), and the delegator
 *           cursor advances PAST the gap instead of being pinned at the R->0
 *           drop; an identical validator with NO heal record stays pinned.
 *
 * Note: testSetup bypasses initialize(), so the SFC _owner is address(0); the
 * owner-bypass branch is pre-existing behaviour and is not exercised here. The
 * self-service branch (the new surface) is fully covered.
 *
 * Run:  npx hardhat test tests/unit/reactivate-self-service.hh.test.js
 */

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

const COMBINED_PATH = path.join(
  __dirname,
  '..',
  'contracts',
  'artifacts',
  'SFCCursorTestHarness.combined.json',
);
const HARNESS_KEY =
  'tests/contracts/SFCCursorTestHarness.sol:SFCCursorTestHarness';
const MOCK_KEY = 'tests/contracts/SFCCursorTestHarness.sol:MockNodeDriver';

function loadContract(key) {
  const combined = JSON.parse(fs.readFileSync(COMBINED_PATH, 'utf8'));
  const c = combined.contracts[key];
  if (!c) {
    throw new Error(
      `Contract ${key} not found in combined artifact. Recompile with:\n` +
        `  solc --optimize --optimize-runs 200 --combined-json abi,bin --allow-paths . tests/contracts/SFCCursorTestHarness.sol > tests/contracts/artifacts/SFCCursorTestHarness.combined.json`,
    );
  }
  const abi = typeof c.abi === 'string' ? JSON.parse(c.abi) : c.abi;
  return { abi, bytecode: '0x' + c.bin };
}

const OK_STATUS = 0n;
const OFFLINE_BIT = 1n << 3n; // 8
const DOUBLESIGN_BIT = 1n << 7n; // 128

const CREATED_EPOCH = 5n;
const DEACT_EPOCH = 10n; // gap starts at 11
const REENTRY_EPOCH = 13n; // gap epochs: 11, 12
const SEALED = 13n;
const VALIDATOR_ID = 17n;
const CONTROL_ID = 18n;

const MIN_SELF_STAKE = ethers.parseEther('200000');
const RECEIVED = ethers.parseEther('3000000'); // external delegators present, within 16x limit
const R = ethers.parseEther('0.05'); // pre-gap accumulated reward-per-token
const POST = ethers.parseEther('0.06'); // re-entry rate (> R)

describe('SFC self-service reactivateValidator (gate + reward-gap heal)', () => {
  let harness;
  let owner; // deployer; NOT the SFC owner (which is address(0) in the harness)
  let validatorAuth;
  let outsider;
  let delegator;

  async function fresh() {
    [owner, validatorAuth, outsider, delegator] = await ethers.getSigners();

    const Mock = loadContract(MOCK_KEY);
    const mock = await new ethers.ContractFactory(
      Mock.abi,
      Mock.bytecode,
      owner,
    ).deploy();
    await mock.waitForDeployment();

    const H = loadContract(HARNESS_KEY);
    harness = await new ethers.ContractFactory(
      H.abi,
      H.bytecode,
      owner,
    ).deploy();
    await harness.waitForDeployment();

    await (await harness.testSetup(SEALED, await mock.getAddress())).wait();
  }

  // Create an OFFLINE-deactivated validator with self+received stake that
  // satisfies reactivateValidator's pre-conditions, and pre-gap ARPT = R.
  async function setupOfflineValidator(id) {
    await (
      await harness.createValidatorAt(validatorAuth.address, id, CREATED_EPOCH)
    ).wait();
    await (
      await harness.setStakes(
        id,
        validatorAuth.address,
        MIN_SELF_STAKE,
        RECEIVED,
      )
    ).wait();
    // accumulator climbs to R by the deactivation epoch.
    await (await harness.setEpochARPT(CREATED_EPOCH, id, 0n)).wait();
    await (await harness.setEpochARPT(DEACT_EPOCH, id, R)).wait();
    // gap epochs 11,12 are left unset (raw 0); re-entry epoch is above R.
    await (await harness.setEpochARPT(REENTRY_EPOCH, id, POST)).wait();
    // OFFLINE deactivation at DEACT_EPOCH.
    await (
      await harness.deactivate(id, OFFLINE_BIT, DEACT_EPOCH, 1n)
    ).wait();
  }

  describe('gate', () => {
    beforeEach(async () => {
      await fresh();
      await setupOfflineValidator(VALIDATOR_ID);
      await (await harness.setOfflinePenaltyThresholdTime(0n)).wait(); // no cooldown
    });

    it('lets the validator auth self-reactivate an OFFLINE validator', async () => {
      await expect(
        harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID),
      ).to.not.be.reverted;
      const v = await harness.getValidator(VALIDATOR_ID);
      expect(v.status).to.equal(OK_STATUS);
      expect(v.deactivatedEpoch).to.equal(0n);
    });

    it('rejects a non-auth, non-owner caller', async () => {
      await expect(
        harness.connect(outsider).reactivateValidator(VALIDATOR_ID),
      ).to.be.revertedWith('not authorized to reactivate');
    });

    it('rejects a DOUBLESIGN (cheater) validator on the self path', async () => {
      // escalate status to doublesign (severity-monotonic in production)
      await (
        await harness.deactivate(
          VALIDATOR_ID,
          OFFLINE_BIT | DOUBLESIGN_BIT,
          DEACT_EPOCH,
          1n,
        )
      ).wait();
      await expect(
        harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID),
      ).to.be.revertedWith('self-reactivation allowed only from offline status');
    });

    it('enforces the anti-flap cooldown', async () => {
      const now = BigInt((await ethers.provider.getBlock('latest')).timestamp);
      // deactivatedTime = now, threshold huge => cooldown not elapsed
      await (
        await harness.deactivate(VALIDATOR_ID, OFFLINE_BIT, DEACT_EPOCH, now)
      ).wait();
      await (
        await harness.setOfflinePenaltyThresholdTime(1000000000n)
      ).wait();
      await expect(
        harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID),
      ).to.be.revertedWith('reactivation cooldown not elapsed');
      // once the threshold is cleared, the same call succeeds
      await (await harness.setOfflinePenaltyThresholdTime(0n)).wait();
      await expect(
        harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID),
      ).to.not.be.reverted;
    });
  });

  describe('heal capture + read-through', () => {
    beforeEach(async () => {
      await fresh();
      await setupOfflineValidator(VALIDATOR_ID);
      await (await harness.setOfflinePenaltyThresholdTime(0n)).wait();
    });

    it('captures healFloor = ARPT[deactivatedEpoch] and healFrom = deactivatedEpoch+1', async () => {
      await (
        await harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID)
      ).wait();
      expect(await harness.reactivationHealFloor(VALIDATOR_ID)).to.equal(R);
      expect(await harness.reactivationHealFrom(VALIDATOR_ID)).to.equal(
        DEACT_EPOCH + 1n,
      );
    });

    it('makes gap epochs read the healed floor R instead of raw 0', async () => {
      await (
        await harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID)
      ).wait();
      // gap epochs 11, 12 have raw ARPT 0 but must read R via the heal branch
      expect(await harness.effectiveRate(11n, VALIDATOR_ID)).to.equal(R);
      expect(await harness.effectiveRate(12n, VALIDATOR_ID)).to.equal(R);
      // pre-gap and re-entry epochs are untouched (raw values)
      expect(await harness.effectiveRate(DEACT_EPOCH, VALIDATOR_ID)).to.equal(R);
      expect(await harness.effectiveRate(REENTRY_EPOCH, VALIDATOR_ID)).to.equal(
        POST,
      );
    });

    it('advances a delegator cursor PAST a healed gap (not frozen)', async () => {
      await (
        await harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID)
      ).wait();
      // delegator cursor sits pre-gap; scan must reach the payable epoch
      await (
        await harness.forceCursor(delegator.address, VALIDATOR_ID, CREATED_EPOCH)
      ).wait();
      const safe = await harness.safeCursor(
        delegator.address,
        VALIDATOR_ID,
        REENTRY_EPOCH,
      );
      expect(safe).to.equal(REENTRY_EPOCH);
    });

    it('heal floor honors an owner-corrected deactivation epoch (no re-inversion)', async () => {
      // deactEpoch has raw ARPT = R but was corrected upward to R_corr (between R and POST).
      const R_corr = ethers.parseEther('0.055');
      await (await harness.setCorrected(DEACT_EPOCH, VALIDATOR_ID, R_corr)).wait();
      await (
        await harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID)
      ).wait();
      // floor must capture the CORRECTED rate, not the raw snapshot R
      expect(await harness.reactivationHealFloor(VALIDATOR_ID)).to.equal(R_corr);
      // deactEpoch reads corrected; gap epochs heal to the same corrected floor -> no inversion
      expect(await harness.effectiveRate(DEACT_EPOCH, VALIDATOR_ID)).to.equal(R_corr);
      expect(await harness.effectiveRate(11n, VALIDATOR_ID)).to.equal(R_corr);
      // delegator cursor advances past the gap (would pin at DEACT_EPOCH with a raw floor)
      await (
        await harness.forceCursor(delegator.address, VALIDATOR_ID, CREATED_EPOCH)
      ).wait();
      expect(
        await harness.safeCursor(delegator.address, VALIDATOR_ID, REENTRY_EPOCH),
      ).to.equal(REENTRY_EPOCH);
    });

    it('repeated reactivation physically heals the prior gap (no re-stranding)', async () => {
      // Gap 1: validator deactivated at DEACT_EPOCH(10) with pre-gap R; reactivate #1.
      await (
        await harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID)
      ).wait();
      expect(await harness.reactivationHealFloor(VALIDATOR_ID)).to.equal(R); // {R, from=11}
      expect(await harness.reactivationHealFrom(VALIDATOR_ID)).to.equal(11n);

      // Validator active again, earning; then Gap 2 at D2=14 with pre-gap R2.
      const D2 = 14n;
      const R2 = ethers.parseEther('0.07'); // R(0.05) < POST(0.06 at 13) < R2 < 0.08
      await (await harness.setEpochARPT(13n, VALIDATOR_ID, ethers.parseEther('0.06'))).wait();
      await (await harness.setEpochARPT(D2, VALIDATOR_ID, R2)).wait();
      await (await harness.setEpochARPT(17n, VALIDATOR_ID, ethers.parseEther('0.08'))).wait();
      await (await harness.setCurrentSealedEpoch(17n)).wait();
      await (await harness.deactivate(VALIDATOR_ID, OFFLINE_BIT, D2, 1n)).wait();

      // Reactivate #2 -> must physically backfill gap 1 (epochs 11,12 -> R) BEFORE
      // overwriting the {floor,from} record with gap 2's.
      await (
        await harness.connect(validatorAuth).reactivateValidator(VALIDATOR_ID)
      ).wait();

      // Gap 1 epochs are now PHYSICALLY R (raw), not 0 — survives the record overwrite.
      expect(
        await harness.getEpochAccumulatedRewardPerToken(11n, VALIDATOR_ID),
      ).to.equal(R);
      expect(
        await harness.getEpochAccumulatedRewardPerToken(12n, VALIDATOR_ID),
      ).to.equal(R);
      // New record is gap 2's; gap 2 (15,16) heals via the read-through.
      expect(await harness.reactivationHealFloor(VALIDATOR_ID)).to.equal(R2);
      expect(await harness.reactivationHealFrom(VALIDATOR_ID)).to.equal(D2 + 1n);
      expect(await harness.effectiveRate(15n, VALIDATOR_ID)).to.equal(R2);

      // A fully passive delegator (cursor pre-gap1) advances past BOTH gaps — not
      // re-stranded at gap 1 (which would happen if the prior gap were not backfilled).
      await (
        await harness.forceCursor(delegator.address, VALIDATOR_ID, CREATED_EPOCH)
      ).wait();
      expect(
        await harness.safeCursor(delegator.address, VALIDATOR_ID, 17n),
      ).to.equal(17n);
    });

    it('control: an identical validator WITHOUT a heal record stays pinned at the gap', async () => {
      // same ARPT shape, never reactivated => no heal record. Uses a distinct
      // auth (one auth address cannot own two validators: _rawCreateValidator
      // reverts "validator already exists").
      await (
        await harness.createValidatorAt(
          outsider.address,
          CONTROL_ID,
          CREATED_EPOCH,
        )
      ).wait();
      await (await harness.setEpochARPT(DEACT_EPOCH, CONTROL_ID, R)).wait();
      await (await harness.setEpochARPT(REENTRY_EPOCH, CONTROL_ID, POST)).wait();
      await (
        await harness.forceCursor(delegator.address, CONTROL_ID, CREATED_EPOCH)
      ).wait();
      // raw gap epoch reads 0 (no heal) and pins the cursor at the R->0 drop
      expect(await harness.effectiveRate(11n, CONTROL_ID)).to.equal(0n);
      const safe = await harness.safeCursor(
        delegator.address,
        CONTROL_ID,
        REENTRY_EPOCH,
      );
      expect(safe).to.equal(DEACT_EPOCH); // pinned at last non-inverted epoch
    });
  });
});
