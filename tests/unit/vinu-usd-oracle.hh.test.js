const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

// Behavioural unit tests for VinuUsdOracle. These deploy the canonical
// pre-compiled artifact at contracts/vns/source/artifacts/... against the
// in-process hardhat EDR network and exercise every revert path, owner-only
// gate, and time-dependent state transition that the structural tests in
// vns-pricing-oracle.test.js cannot cover.

const ARTIFACT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'contracts',
  'vns',
  'source',
  'artifacts',
  'contracts',
  'ethregistrar',
  'VinuUsdOracle.sol',
  'VinuUsdOracle.json',
);

function loadArtifact() {
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
}

const ONE_HOUR = 60n * 60n;
const ONE_DAY = 24n * ONE_HOUR;
const TWELVE_HOURS = 12n * ONE_HOUR;
const SEVEN_DAYS = 7n * ONE_DAY;

// Helper: deploy a fresh VinuUsdOracle with sensible defaults. Individual
// tests override one parameter at a time.
async function deployOracle(overrides = {}) {
  const artifact = loadArtifact();
  const [owner, other] = await ethers.getSigners();
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    owner,
  );
  const initialAnswer = overrides.initialAnswer ?? 50_000_000n; // $0.50 at 8 decimals
  const initialSource = overrides.initialSource ?? 'coingecko';
  const initialMaxAge = overrides.initialMaxAge ?? TWELVE_HOURS;
  const initialMinAnswer = overrides.initialMinAnswer ?? 1_000n;
  const initialMaxAnswer = overrides.initialMaxAnswer ?? 1_000_000_000n;
  const initialMaxChangeBps = overrides.initialMaxChangeBps ?? 2000n; // 20%
  const oracle = await factory.deploy(
    initialAnswer,
    initialSource,
    initialMaxAge,
    initialMinAnswer,
    initialMaxAnswer,
    initialMaxChangeBps,
  );
  await oracle.waitForDeployment();
  return { oracle, owner, other };
}

describe('VinuUsdOracle (behavioural)', () => {
  describe('constructor + read invariants', () => {
    it('persists constructor parameters and reports decimals/description/version', async () => {
      const { oracle } = await deployOracle();
      expect(await oracle.decimals()).to.equal(8);
      expect(await oracle.description()).to.equal('VC / USD');
      expect(await oracle.version()).to.equal(1n);
      expect(await oracle.maxAge()).to.equal(TWELVE_HOURS);
      expect(await oracle.minAnswer()).to.equal(1_000n);
      expect(await oracle.maxAnswer()).to.equal(1_000_000_000n);
      expect(await oracle.maxChangeBps()).to.equal(2000n);
      expect(await oracle.source()).to.equal('coingecko');
      expect(await oracle.latestStoredAnswer()).to.equal(50_000_000n);
      expect(await oracle.latestAnswer()).to.equal(50_000_000n);
    });

    it('rejects construction with maxAge below 1 hour, above 7 days, or above the 12h ceiling', async () => {
      await expect(deployOracle({ initialMaxAge: ONE_HOUR - 1n }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'InvalidMaxAge',
        );
      await expect(deployOracle({ initialMaxAge: SEVEN_DAYS + 1n }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'InvalidMaxAge',
        );
      await expect(deployOracle({ initialMaxAge: ONE_DAY }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'MaxAgeAboveCeiling',
        );
    });

    it('rejects construction with min==0 or max<min', async () => {
      await expect(
        deployOracle({ initialMinAnswer: 0n, initialMaxAnswer: 1n }),
      ).to.be.revertedWithCustomError(loadOracleInterface(), 'InvalidBounds');
      await expect(
        deployOracle({ initialMinAnswer: 10n, initialMaxAnswer: 9n }),
      ).to.be.revertedWithCustomError(loadOracleInterface(), 'InvalidBounds');
    });

    it('rejects construction with maxChangeBps==0 or >BPS_DENOMINATOR', async () => {
      await expect(deployOracle({ initialMaxChangeBps: 0n }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'InvalidMaxChangeBps',
        );
      await expect(deployOracle({ initialMaxChangeBps: 10_001n }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'InvalidMaxChangeBps',
        );
      await expect(deployOracle({ initialMaxChangeBps: 2001n }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'MaxChangeBpsAboveCeiling',
        );
    });

    it('rejects construction with non-positive initial answer', async () => {
      await expect(deployOracle({ initialAnswer: 0n }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'InvalidAnswer',
        );
      await expect(deployOracle({ initialAnswer: -1n }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'InvalidAnswer',
        );
    });

    it('rejects construction with source string longer than 32 bytes', async () => {
      const tooLong = 'x'.repeat(33);
      await expect(deployOracle({ initialSource: tooLong }))
        .to.be.revertedWithCustomError(
          loadOracleInterface(),
          'SourceTooLong',
        );
    });

    it('rejects construction with initial answer outside bounds', async () => {
      await expect(
        deployOracle({
          initialAnswer: 999n,
          initialMinAnswer: 1_000n,
          initialMaxAnswer: 1_000_000n,
        }),
      ).to.be.revertedWithCustomError(
        loadOracleInterface(),
        'AnswerOutOfBounds',
      );
      await expect(
        deployOracle({
          initialAnswer: 1_000_001n,
          initialMinAnswer: 1_000n,
          initialMaxAnswer: 1_000_000n,
        }),
      ).to.be.revertedWithCustomError(
        loadOracleInterface(),
        'AnswerOutOfBounds',
      );
    });
  });

  describe('staleness', () => {
    it('latestAnswer reverts once block.timestamp > updatedAt + maxAge', async () => {
      const { oracle } = await deployOracle({ initialMaxAge: ONE_HOUR });
      // Inside the window the call succeeds.
      await time.increase(60 * 30);
      expect(await oracle.latestAnswer()).to.equal(50_000_000n);
      // Step past maxAge and confirm the read reverts.
      await time.increase(60 * 31);
      await expect(oracle.latestAnswer()).to.be.revertedWithCustomError(
        loadOracleInterface(),
        'StaleAnswer',
      );
      // latestStoredAnswer remains callable through the stale window.
      expect(await oracle.latestStoredAnswer()).to.equal(50_000_000n);
    });

    it('a fresh setLatestAnswer restores read access after staleness', async () => {
      const { oracle } = await deployOracle({ initialMaxAge: ONE_HOUR });
      await time.increase(60 * 65);
      await expect(oracle.latestAnswer()).to.be.revertedWithCustomError(
        loadOracleInterface(),
        'StaleAnswer',
      );
      await oracle.setLatestAnswer(55_000_000n, 'coingecko+v3-twap');
      expect(await oracle.latestAnswer()).to.equal(55_000_000n);
    });
  });

  describe('owner-only access control', () => {
    it('rejects setLatestAnswer from a non-owner with Ownable string revert', async () => {
      const { oracle, other } = await deployOracle();
      await expect(
        oracle.connect(other).setLatestAnswer(60_000_000n, 'coingecko'),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('rejects setMaxAge from non-owner', async () => {
      const { oracle, other } = await deployOracle();
      await expect(
        oracle.connect(other).setMaxAge(2n * ONE_DAY),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('rejects setBounds from non-owner', async () => {
      const { oracle, other } = await deployOracle();
      await expect(
        oracle.connect(other).setBounds(500n, 2_000_000_000n),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('rejects setMaxChangeBps from non-owner', async () => {
      const { oracle, other } = await deployOracle();
      await expect(
        oracle.connect(other).setMaxChangeBps(1500n),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('setLatestAnswer guards', () => {
    it('rejects non-positive answers with InvalidAnswer', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setLatestAnswer(0n, 'coingecko'))
        .to.be.revertedWithCustomError(oracle, 'InvalidAnswer');
      await expect(oracle.setLatestAnswer(-1n, 'coingecko'))
        .to.be.revertedWithCustomError(oracle, 'InvalidAnswer');
    });

    it('rejects out-of-bounds answers with AnswerOutOfBounds', async () => {
      const { oracle } = await deployOracle({
        initialAnswer: 50_000_000n,
        initialMinAnswer: 45_000_000n,
        initialMaxAnswer: 55_000_000n,
      });
      await expect(oracle.setLatestAnswer(44_000_000n, 'coingecko'))
        .to.be.revertedWithCustomError(oracle, 'AnswerOutOfBounds');
      await expect(oracle.setLatestAnswer(56_000_000n, 'coingecko'))
        .to.be.revertedWithCustomError(oracle, 'AnswerOutOfBounds');
    });

    it('rejects source strings longer than 32 bytes with SourceTooLong', async () => {
      const { oracle } = await deployOracle();
      const tooLong = 'x'.repeat(33);
      await expect(oracle.setLatestAnswer(50_000_001n, tooLong))
        .to.be.revertedWithCustomError(oracle, 'SourceTooLong');
    });

    it('accepts exactly the 32-byte source boundary', async () => {
      const { oracle } = await deployOracle();
      const exactly32 = 'x'.repeat(32);
      await expect(oracle.setLatestAnswer(50_000_001n, exactly32)).to.not.be.reverted;
      expect(await oracle.source()).to.equal(exactly32);
    });

    it('rejects changes that exceed maxChangeBps with AnswerChangeTooLarge', async () => {
      // 20% per call. 50M -> 61M would be 22% delta, must revert.
      const { oracle } = await deployOracle({
        initialAnswer: 50_000_000n,
        initialMaxChangeBps: 2000n,
      });
      await expect(oracle.setLatestAnswer(61_000_000n, 'coingecko'))
        .to.be.revertedWithCustomError(oracle, 'AnswerChangeTooLarge');
    });

    it('accepts exactly the maxChangeBps boundary', async () => {
      // 20% of 50M = 10M. New = 60M is exactly the boundary; new = 60_000_001 is just over.
      const { oracle } = await deployOracle({
        initialAnswer: 50_000_000n,
        initialMaxChangeBps: 2000n,
      });
      await expect(oracle.setLatestAnswer(60_000_000n, 'coingecko')).to.not.be.reverted;
      // Step further; now previous is 60M and 20% is 12M, so 72M is still allowed.
      await expect(oracle.setLatestAnswer(72_000_000n, 'coingecko')).to.not.be.reverted;
    });

    it('updates updatedAt to block.timestamp on successful set', async () => {
      const { oracle } = await deployOracle();
      await time.increase(120);
      await oracle.setLatestAnswer(55_000_000n, 'coingecko');
      const latestBlock = await ethers.provider.getBlock('latest');
      expect(await oracle.updatedAt()).to.equal(BigInt(latestBlock.timestamp));
    });

    it('emits AnswerUpdated on a successful set', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setLatestAnswer(55_000_000n, 'coingecko+v3-twap'))
        .to.emit(oracle, 'AnswerUpdated');
    });
  });

  describe('setBounds re-check', () => {
    it('re-checks the current answer against new bounds and reverts if outside', async () => {
      const { oracle } = await deployOracle({
        initialAnswer: 50_000_000n,
        initialMinAnswer: 1_000n,
        initialMaxAnswer: 1_000_000_000n,
      });
      // Trying to set new bounds that exclude the current answer must revert.
      await expect(oracle.setBounds(60_000_000n, 100_000_000n))
        .to.be.revertedWithCustomError(oracle, 'AnswerOutOfBounds');
      await expect(oracle.setBounds(10_000n, 49_000_000n))
        .to.be.revertedWithCustomError(oracle, 'AnswerOutOfBounds');
    });

    it('accepts bounded widened bounds that still contain the current answer', async () => {
      const { oracle } = await deployOracle({ initialAnswer: 50_000_000n });
      await expect(oracle.setBounds(1_000n, 1_999_999_000n)).to.not.be.reverted;
      expect(await oracle.minAnswer()).to.equal(1_000n);
      expect(await oracle.maxAnswer()).to.equal(1_999_999_000n);
    });

    it('rejects bounds widened by more than the 2x ceiling', async () => {
      const { oracle } = await deployOracle({ initialAnswer: 50_000_000n });
      await expect(oracle.setBounds(1n, 10n ** 18n))
        .to.be.revertedWithCustomError(oracle, 'BoundsWidenedTooMuch');
    });

    it('rejects new bounds where min==0 or max<min', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setBounds(0n, 1n))
        .to.be.revertedWithCustomError(oracle, 'InvalidBounds');
      await expect(oracle.setBounds(100n, 99n))
        .to.be.revertedWithCustomError(oracle, 'InvalidBounds');
    });

    it('emits BoundsUpdated on successful set', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setBounds(2_000n, 2_000_000_000n))
        .to.emit(oracle, 'BoundsUpdated').withArgs(2_000n, 2_000_000_000n);
    });
  });

  describe('setMaxAge window', () => {
    it('rejects values outside 1 hour..7 days', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxAge(ONE_HOUR - 1n))
        .to.be.revertedWithCustomError(oracle, 'InvalidMaxAge');
      await expect(oracle.setMaxAge(SEVEN_DAYS + 1n))
        .to.be.revertedWithCustomError(oracle, 'InvalidMaxAge');
    });

    it('rejects values above the 12h ceiling', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxAge(ONE_DAY))
        .to.be.revertedWithCustomError(oracle, 'MaxAgeAboveCeiling');
      await expect(oracle.setMaxAge(SEVEN_DAYS))
        .to.be.revertedWithCustomError(oracle, 'MaxAgeAboveCeiling');
    });

    it('accepts boundary values 1 hour and 12 hours', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxAge(ONE_HOUR)).to.not.be.reverted;
      await expect(oracle.setMaxAge(TWELVE_HOURS)).to.not.be.reverted;
    });

    it('emits MaxAgeUpdated', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxAge(6n * ONE_HOUR))
        .to.emit(oracle, 'MaxAgeUpdated').withArgs(6n * ONE_HOUR);
    });
  });

  describe('setMaxChangeBps window', () => {
    it('rejects 0 and >BPS_DENOMINATOR', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxChangeBps(0n))
        .to.be.revertedWithCustomError(oracle, 'InvalidMaxChangeBps');
      await expect(oracle.setMaxChangeBps(10_001n))
        .to.be.revertedWithCustomError(oracle, 'InvalidMaxChangeBps');
    });

    it('rejects values above the 20% ceiling', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxChangeBps(2001n))
        .to.be.revertedWithCustomError(oracle, 'MaxChangeBpsAboveCeiling');
      await expect(oracle.setMaxChangeBps(10_000n))
        .to.be.revertedWithCustomError(oracle, 'MaxChangeBpsAboveCeiling');
    });

    it('accepts 1 (0.01% per update) and the 20% ceiling', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxChangeBps(1n)).to.not.be.reverted;
      await expect(oracle.setMaxChangeBps(2000n)).to.not.be.reverted;
    });

    it('emits MaxChangeBpsUpdated', async () => {
      const { oracle } = await deployOracle();
      await expect(oracle.setMaxChangeBps(1500n))
        .to.emit(oracle, 'MaxChangeBpsUpdated').withArgs(1500n);
    });
  });
});

// ----- helpers -----

// Some hardhat-chai-matcher overloads want the contract Interface, not an
// instance. Lazily build one from the canonical artifact ABI so cases that
// expect a revert during construction (no instance exists yet) can still
// match a custom error.
let _oracleInterface = null;
function loadOracleInterface() {
  if (_oracleInterface) return _oracleInterface;
  const artifact = loadArtifact();
  const proxy = new ethers.BaseContract(
    ethers.ZeroAddress,
    artifact.abi,
  );
  _oracleInterface = proxy;
  return _oracleInterface;
}
