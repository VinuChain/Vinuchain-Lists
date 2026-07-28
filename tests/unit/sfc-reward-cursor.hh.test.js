/**
 * Behavioural test for the SFC reward-cursor initialization fix in
 * contracts/vinuchain/SFC.sol::_rawDelegate.
 *
 * Bug being guarded against:
 *   _rawDelegate stashes rewards before incrementing getStake but never
 *   initialized stashedRewardsUntilEpoch. For a delegator who joins after
 *   genesis, the cursor therefore started at 0 and could only advance
 *   MAX_CORRUPTION_CHECK_EPOCHS (100) epochs per _stashRewards call. That left
 *   the cursor stranded in the all-zero-ARPT dead zone below the validator's
 *   createdEpoch, so claimRewards/restakeRewards reverted "zero rewards" while
 *   pendingRewards() (a view) integrated the full range and over-reported.
 *
 * The fix seeds stashedRewardsUntilEpoch = currentSealedEpoch on a genuine
 * first delegation (getStake==0 && cursor==0), so accrual starts in the live
 * zone above createdEpoch.
 *
 * This test deploys the real (fixed) SFC via the SFCCursorTestHarness subclass
 * compiled with solc 0.5.17, and proves:
 *   1. a fresh delegation seeds the cursor to currentSealedEpoch (not 0),
 *   2. once ARPT accrues above createdEpoch, claimRewards succeeds for a
 *      non-genesis delegator (no "zero rewards" revert),
 *   3. a re-delegation does NOT clobber an existing non-zero cursor.
 *
 * Run:  npx hardhat test tests/unit/sfc-reward-cursor.hh.test.js
 * (or via `npm run test:hardhat`, which globs tests/**\/*.hh.test.js)
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

// A non-genesis validator: createdEpoch sits far above 0, leaving a large
// all-zero-ARPT dead zone (epochs 0..CREATED_EPOCH) below it.
const CREATED_EPOCH = 5748;
const FIRST_REWARD_EPOCH = CREATED_EPOCH + 1; // 5749
const SEALED_AT_DELEGATION = 5800;
const VALIDATOR_ID = 17;
const STAKE = ethers.parseEther('1000');
const ARPT_STEP = ethers.parseEther('0.01'); // monotonic positive ARPT step

describe('SFC reward-cursor initialization (_rawDelegate fix)', () => {
  let harness;
  let owner;
  let delegator;
  let validatorAuth;

  async function deployHarness() {
    [owner, delegator, validatorAuth] = await ethers.getSigners();

    const mockMeta = loadContract(MOCK_KEY);
    const MockFactory = new ethers.ContractFactory(
      mockMeta.abi,
      mockMeta.bytecode,
      owner,
    );
    const mock = await MockFactory.deploy();
    await mock.waitForDeployment();

    const meta = loadContract(HARNESS_KEY);
    const Factory = new ethers.ContractFactory(meta.abi, meta.bytecode, owner);
    const h = await Factory.deploy();
    await h.waitForDeployment();

    // The production SFC constructor locks the implementation, so the real
    // initialize() cannot run on a bare deploy. testSetup writes the same
    // minimal state directly (see SFCCursorTestHarness.sol).
    await h.testSetup(SEALED_AT_DELEGATION, await mock.getAddress());

    // Fund the SFC harness so claimRewards()'s native payout can succeed
    // (on-chain this balance is minted via node.incBalance).
    await h.fund({ value: ethers.parseEther('100') });

    // Register a post-genesis validator.
    await h.createValidatorAt(
      validatorAuth.address,
      VALIDATOR_ID,
      CREATED_EPOCH,
    );

    return h;
  }

  beforeEach(async () => {
    harness = await deployHarness();
  });

  it('seeds the cursor to currentSealedEpoch+1 (not 0) on a fresh delegation', async () => {
    expect(await harness.cursor(delegator.address, VALIDATOR_ID)).to.equal(0n);
    expect(await harness.stakeOf(delegator.address, VALIDATOR_ID)).to.equal(0n);

    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);

    // Without the fix this would be 0 (or a tiny crawl from 0); with the fix it equals
    // currentSealedEpoch+1 — the first epoch whose reward snapshot can include this stake
    // (currentSealedEpoch would over-mint the E->E+1 delta whose denominator excludes it).
    const cursor = await harness.cursor(delegator.address, VALIDATOR_ID);
    expect(cursor).to.equal(BigInt(SEALED_AT_DELEGATION + 1));
    expect(cursor).to.be.greaterThan(BigInt(CREATED_EPOCH));
  });

  it('lets a non-genesis delegator claimRewards once ARPT accrues (no "zero rewards")', async () => {
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);

    // Dead zone below createdEpoch stays all-zero ARPT; the bug stranded the
    // cursor here. Seed it explicitly to model the real chain state.
    for (let e = 0; e <= CREATED_EPOCH; e++) {
      // leave ARPT at default 0 — too many writes to loop on-chain, so we only
      // need the live-zone epochs below; the dead zone is implicitly zero.
      break;
    }

    // Accrue positive, monotonically increasing ARPT in the live zone, then
    // advance the sealed epoch so _highestPayableEpoch moves forward.
    const liveStart = SEALED_AT_DELEGATION + 1; // cursor sits here post-fix (seed = sealed+1)
    const liveEnd = SEALED_AT_DELEGATION + 10;
    for (let e = liveStart; e <= liveEnd; e++) {
      const mult = BigInt(e - liveStart);
      await harness.setEpochARPT(e, VALIDATOR_ID, ARPT_STEP * mult);
    }
    await harness.setCurrentSealedEpoch(liveEnd);

    // pendingRewards should now be positive...
    const pending = await harness.pendingRewards(
      delegator.address,
      VALIDATOR_ID,
    );
    expect(pending).to.be.greaterThan(0n);

    // ...and claimRewards must succeed (the regression: it reverted "zero
    // rewards" because the cursor was stranded in the dead zone).
    const harnessAsDelegator = harness.connect(delegator);
    await expect(harnessAsDelegator.claimRewards(VALIDATOR_ID)).to.not.be
      .reverted;
  });

  it('reverts "zero rewards" only when there is genuinely nothing to claim', async () => {
    // Fresh delegation, no ARPT accrual at all -> claim should still revert,
    // proving the fix does not fabricate phantom rewards.
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);
    const harnessAsDelegator = harness.connect(delegator);
    await expect(
      harnessAsDelegator.claimRewards(VALIDATOR_ID),
    ).to.be.revertedWith('zero rewards');
  });

  it('does NOT clobber an existing non-zero cursor on re-delegation', async () => {
    // First delegation seeds the cursor.
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);
    const seeded = await harness.cursor(delegator.address, VALIDATOR_ID);
    expect(seeded).to.equal(BigInt(SEALED_AT_DELEGATION + 1));

    // Emulate the cursor having advanced through real reward processing.
    const advanced = BigInt(SEALED_AT_DELEGATION + 25);
    await harness.forceCursor(delegator.address, VALIDATOR_ID, advanced);
    await harness.setCurrentSealedEpoch(SEALED_AT_DELEGATION + 25);

    // Re-delegate (getStake is now > 0 -> the seeding guard must NOT fire).
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);

    const after = await harness.cursor(delegator.address, VALIDATOR_ID);
    // getStake > 0 here, so the only writer is _stashRewards. With flat/zero ARPT the
    // monotonic guard keeps the cursor at the value it already had; it is NOT reset by a seed.
    expect(after).to.equal(advanced);
  });

  it('delegating twice in one epoch keeps the currentSealedEpoch+1 seed (monotonic cursor)', async () => {
    // First (fresh) delegation seeds the cursor to currentSealedEpoch+1.
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);
    expect(await harness.cursor(delegator.address, VALIDATOR_ID)).to.equal(
      BigInt(SEALED_AT_DELEGATION + 1),
    );
    // A second delegation in the SAME epoch (getStake>0 -> _stashRewards path). Without the
    // monotonic-cursor guard this would drag the cursor back to currentSealedEpoch (reopening the
    // one-epoch over-mint); with it, the +1 seed survives.
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);
    expect(await harness.cursor(delegator.address, VALIDATOR_ID)).to.equal(
      BigInt(SEALED_AT_DELEGATION + 1),
    );
  });

  it('re-seeds a returning delegator (full exit then re-delegate) to currentSealedEpoch+1', async () => {
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);
    // Simulate a full exit: stake -> 0, but the cursor keeps a stale (earlier) value.
    await harness.forceStake(delegator.address, VALIDATOR_ID, 0n);
    await harness.forceCursor(
      delegator.address,
      VALIDATOR_ID,
      BigInt(SEALED_AT_DELEGATION - 50),
    );
    // Re-delegate at a later sealed epoch. getStake==0 -> the seed guard must fire and re-seed to
    // sealed+1, NOT fall through to _stashRewards (which would settle at sealed and over-mint).
    const newSealed = SEALED_AT_DELEGATION + 30;
    await harness.setCurrentSealedEpoch(newSealed);
    await harness.delegate(delegator.address, VALIDATOR_ID, STAKE);
    expect(await harness.cursor(delegator.address, VALIDATOR_ID)).to.equal(
      BigInt(newSealed + 1),
    );
  });
});
