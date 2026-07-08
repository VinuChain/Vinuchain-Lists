pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

library Decimal {
    function unit() internal pure returns (uint256) {
        return 1e18;
    }
}

contract Initializable {

  bool private initialized;

  bool private initializing;

  modifier initializer() {
    require(initializing || isConstructor() || !initialized, "Contract instance has already been initialized");

    bool isTopLevelCall = !initializing;
    if (isTopLevelCall) {
      initializing = true;
      initialized = true;
    }

    _;

    if (isTopLevelCall) {
      initializing = false;
    }
  }

  function isConstructor() private view returns (bool) {
    // extcodesize checks the size of the code stored in an address, and
    // address returns the current address. Since the code is still not
    // deployed when running a constructor, any checks on its code size will
    // yield zero, making it an effective way to detect if a contract is
    // under construction or not.
    address self = address(this);
    uint256 cs;
    assembly { cs := extcodesize(self) }
    return cs == 0;
  }

  // Reserved storage space to allow for layout changes in the future.
  // Storage layout: 2 vars (initialized, initializing packed in slot 0) + 50 gap = 51 slots total
  uint256[50] private __gap;
}

library SafeMath {
    /**
     * @dev Returns the addition of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `+` operator.
     *
     * Requirements:
     * - Addition cannot overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");

        return c;
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting on
     * overflow (when the result is negative).
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     * - Subtraction cannot overflow.
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return sub(a, b, "SafeMath: subtraction overflow");
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting with custom message on
     * overflow (when the result is negative).
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     * - Subtraction cannot overflow.
     *
     * _Available since v2.4.0._
     */
    function sub(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b <= a, errorMessage);
        uint256 c = a - b;

        return c;
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `*` operator.
     *
     * Requirements:
     * - Multiplication cannot overflow.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
        // benefit is lost if 'b' is also tested.
        // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
        if (a == 0) {
            return 0;
        }

        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");

        return c;
    }

    /**
     * @dev Returns the integer division of two unsigned integers. Reverts on
     * division by zero. The result is rounded towards zero.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        return div(a, b, "SafeMath: division by zero");
    }

    /**
     * @dev Returns the integer division of two unsigned integers. Reverts with custom message on
     * division by zero. The result is rounded towards zero.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     *
     * _Available since v2.4.0._
     */
    function div(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        // Solidity only automatically asserts when dividing by 0
        require(b > 0, errorMessage);
        uint256 c = a / b;
        // assert(a == b * c + a % b); // There is no case in which this doesn't hold

        return c;
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers. (unsigned integer modulo),
     * Reverts when dividing by zero.
     *
     * Counterpart to Solidity's `%` operator. This function uses a `revert`
     * opcode (which leaves remaining gas untouched) while Solidity uses an
     * invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     */
    function mod(uint256 a, uint256 b) internal pure returns (uint256) {
        return mod(a, b, "SafeMath: modulo by zero");
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers. (unsigned integer modulo),
     * Reverts with custom message when dividing by zero.
     *
     * Counterpart to Solidity's `%` operator. This function uses a `revert`
     * opcode (which leaves remaining gas untouched) while Solidity uses an
     * invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     * - The divisor cannot be zero.
     *
     * _Available since v2.4.0._
     */
    function mod(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b != 0, errorMessage);
        return a % b;
    }
}

contract Ownable is Initializable {
    using SafeMath for uint256;

    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function initialize(address sender) internal initializer {
        _owner = sender;
        emit OwnershipTransferred(address(0), _owner);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    modifier onlyOwner() {
        require(isOwner(), "Ownable: caller is not the owner");
        _;
    }

    function isOwner() public view returns (bool) {
        return msg.sender == _owner;
    }

    // Override renounceOwnership to prevent accidental loss of admin access
    function renounceOwnership() public onlyOwner {
        revert("renounce ownership is disabled");
    }

    address private _pendingOwner;
    uint256 private _pendingOwnerDeadline;

    uint256 internal constant OWNERSHIP_TRANSFER_WINDOW = 7 days;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        // Prevent overwriting a live pending transfer: the pending new owner could
        // front-run the overwrite by calling acceptOwnership() before it lands,
        // taking control with an address the current owner intended to cancel.
        require(
            _pendingOwner == address(0) || block.timestamp > _pendingOwnerDeadline,
            "Ownable: pending transfer still active; wait for expiry"
        );
        _pendingOwner = newOwner;
        _pendingOwnerDeadline = block.timestamp.add(OWNERSHIP_TRANSFER_WINDOW);
        emit OwnershipTransferStarted(_owner, newOwner);
    }

    function acceptOwnership() public {
        require(msg.sender == _pendingOwner, "Ownable: caller is not the pending owner");
        require(block.timestamp <= _pendingOwnerDeadline, "Ownable: transfer expired");
        emit OwnershipTransferred(_owner, _pendingOwner);
        _owner = _pendingOwner;
        _pendingOwner = address(0);
        _pendingOwnerDeadline = 0;
    }

    function pendingOwner() public view returns (address) {
        if (block.timestamp > _pendingOwnerDeadline) {
            return address(0);
        }
        return _pendingOwner;
    }

    function pendingOwnerDeadline() public view returns (uint256) {
        return _pendingOwnerDeadline;
    }

    // Storage layout: _owner (1 slot) + _pendingOwner (1 slot) + _pendingOwnerDeadline (1 slot) + 48 gap = 51 slots
    // Note: inherits Initializable's 51 slots (slots 0-50), Ownable starts at slot 51
    uint256[48] private __gap;
}

// ReentrancyGuard is NOT a standalone contract — it is implemented inline within SFC
// to avoid inserting 50 storage slots into the inheritance chain, which would break
// proxy upgrades. See SFC._reentrancyGuardCounter and SFC.nonReentrant().

contract NodeDriverAuth is Initializable, Ownable {
    using SafeMath for uint256;

    uint256 public constant ADMIN_TIMELOCK = 2 days;
    uint256 public constant MAX_ADVANCE_EPOCHS = 10;
    uint256 public constant MAX_INC_NONCE = 256;

    SFC internal sfc;
    NodeDriver internal driver;

    address public pendingMigration;
    uint256 public pendingMigrationUnlockTime;

    address public pendingCopyCodeTarget;
    address public pendingCopyCodeSource;
    uint256 public pendingCopyCodeUnlockTime;

    event MigrationQueued(address indexed newDriverAuth, uint256 unlockTime);
    event MigrationExecuted(address indexed newDriverAuth);
    event MigrationCancelled();
    event CopyCodeQueued(address indexed acc, address indexed from, uint256 unlockTime);
    event CopyCodeExecuted(address indexed acc, address indexed from);
    event CopyCodeCancelled();
    event NonceIncremented(address indexed acc, uint256 diff);

    function initialize(
        address _sfc,
        address _driver,
        address _owner
    ) external initializer {
        require(_sfc != address(0), "invalid sfc address");
        require(_driver != address(0), "invalid driver address");

        Ownable.initialize(_owner);
        driver = NodeDriver(_driver);
        sfc = SFC(_sfc);
    }

    modifier onlySFC() {
        require(msg.sender == address(sfc), "caller is not the SFC contract");
        _;
    }

    modifier onlyDriver() {
        require(
            msg.sender == address(driver),
            "caller is not the NodeDriver contract"
        );
        _;
    }

    function queueMigration(address newDriverAuth) external onlyOwner {
        require(pendingMigration == address(0) || block.timestamp > pendingMigrationUnlockTime, "migration pending");
        require(newDriverAuth != address(0), "invalid newDriverAuth address");
        require(isContract(newDriverAuth), "newDriverAuth must be a contract");
        pendingMigration = newDriverAuth;
        pendingMigrationUnlockTime = block.timestamp.add(ADMIN_TIMELOCK);
        emit MigrationQueued(newDriverAuth, pendingMigrationUnlockTime);
    }

    function executeMigration() external onlyOwner {
        require(pendingMigrationUnlockTime != 0, "no pending migration");
        require(block.timestamp > pendingMigrationUnlockTime, "timelock not expired");
        address target = pendingMigration;
        require(isContract(target), "target no longer a contract");
        pendingMigration = address(0);
        pendingMigrationUnlockTime = 0;
        driver.setBackend(target);
        emit MigrationExecuted(target);
    }

    /// @dev No cancel-requeue cooldown is applied because this parameter is
    /// forward-only (one-shot structural migration) — the pending value does
    /// not directly subtract from user claims, so the substitution hazard does
    /// not apply. Cooldown is reserved for value-substitution flows
    /// (slashingRefundRatio, epoch corrections) where a cancel-and-substitute
    /// could harm delegators who planned around the pending value.
    function cancelMigration() external onlyOwner {
        require(pendingMigrationUnlockTime != 0, "no pending migration");
        pendingMigration = address(0);
        pendingMigrationUnlockTime = 0;
        emit MigrationCancelled();
    }

    function incBalance(address acc, uint256 diff) external onlySFC {
        require(acc == address(sfc), "recipient is not the SFC contract");
        driver.setBalance(acc, address(acc).balance.add(diff));
    }

    function queueCopyCode(address acc, address from) external onlyOwner {
        require(pendingCopyCodeTarget == address(0) || block.timestamp > pendingCopyCodeUnlockTime, "copyCode pending");
        require(isContract(acc) && isContract(from), "not a contract");
        pendingCopyCodeTarget = acc;
        pendingCopyCodeSource = from;
        pendingCopyCodeUnlockTime = block.timestamp.add(ADMIN_TIMELOCK);
        emit CopyCodeQueued(acc, from, pendingCopyCodeUnlockTime);
    }

    function executeCopyCode() external onlyOwner {
        require(pendingCopyCodeUnlockTime != 0, "no pending copyCode");
        require(block.timestamp > pendingCopyCodeUnlockTime, "timelock not expired");
        address acc = pendingCopyCodeTarget;
        address from = pendingCopyCodeSource;
        require(isContract(acc) && isContract(from), "target or source no longer a contract");
        pendingCopyCodeTarget = address(0);
        pendingCopyCodeSource = address(0);
        pendingCopyCodeUnlockTime = 0;
        driver.copyCode(acc, from);
        emit CopyCodeExecuted(acc, from);
    }

    /// @dev No cancel-requeue cooldown is applied because this parameter is
    /// forward-only (one-shot structural bytecode copy) — the pending value
    /// does not directly subtract from user claims, so the substitution hazard
    /// does not apply. Cooldown is reserved for value-substitution flows
    /// (slashingRefundRatio, epoch corrections) where a cancel-and-substitute
    /// could harm delegators who planned around the pending value.
    function cancelCopyCode() external onlyOwner {
        require(pendingCopyCodeUnlockTime != 0, "no pending copyCode");
        pendingCopyCodeTarget = address(0);
        pendingCopyCodeSource = address(0);
        pendingCopyCodeUnlockTime = 0;
        emit CopyCodeCancelled();
    }

    function incNonce(address acc, uint256 diff) external onlyOwner {
        require(diff <= MAX_INC_NONCE, "nonce increment too large");
        driver.incNonce(acc, diff);
        emit NonceIncremented(acc, diff);
    }

    function updateNetworkRules(bytes calldata diff) external onlyOwner {
        driver.updateNetworkRules(diff);
    }

    function updateNetworkVersion(uint256 version) external onlyOwner {
        driver.updateNetworkVersion(version);
    }

    function advanceEpochs(uint256 num) external onlyOwner {
        require(num <= MAX_ADVANCE_EPOCHS, "too many epochs to advance at once");
        driver.advanceEpochs(num);
    }

    function updateValidatorWeight(uint256 validatorID, uint256 value)
        external
        onlySFC
    {
        driver.updateValidatorWeight(validatorID, value);
    }

    function updateValidatorPubkey(uint256 validatorID, bytes calldata pubkey)
        external
        onlySFC
    {
        // Defence-in-depth: SFC._syncValidator relays already-stored bytes,
        // but a future SFC upgrade or test path could land an unvalidated
        // pubkey here. Reject anything that is not the lachesis-base wire
        // format (0xc0-prefixed, 66 bytes total).
        require(pubkey.length == 66, "invalid pubkey length");
        require(pubkey[0] == 0xc0, "invalid pubkey type");
        driver.updateValidatorPubkey(validatorID, pubkey);
    }

    function setGenesisValidator(
        address _auth,
        uint256 validatorID,
        bytes calldata pubkey,
        uint256 status,
        uint256 createdEpoch,
        uint256 createdTime,
        uint256 deactivatedEpoch,
        uint256 deactivatedTime
    ) external onlyDriver {
        sfc.setGenesisValidator(
            _auth,
            validatorID,
            pubkey,
            status,
            createdEpoch,
            createdTime,
            deactivatedEpoch,
            deactivatedTime
        );
    }

    function setGenesisDelegation(
        address delegator,
        uint256 toValidatorID,
        uint256 stake,
        uint256 lockedStake,
        uint256 lockupFromEpoch,
        uint256 lockupEndTime,
        uint256 lockupDuration,
        uint256 earlyUnlockPenalty,
        uint256 rewards
    ) external onlyDriver {
        sfc.setGenesisDelegation(
            delegator,
            toValidatorID,
            stake,
            lockedStake,
            lockupFromEpoch,
            lockupEndTime,
            lockupDuration,
            earlyUnlockPenalty,
            rewards
        );
    }

    function deactivateValidator(uint256 validatorID, uint256 status)
        external
        onlyDriver
    {
        sfc.deactivateValidator(validatorID, status);
    }

    function sealEpochValidators(uint256[] calldata nextValidatorIDs)
        external
        onlyDriver
    {
        sfc.sealEpochValidators(nextValidatorIDs);
    }

    function sealEpoch(
        uint256[] calldata offlineTimes,
        uint256[] calldata offlineBlocks,
        uint256[] calldata uptimes,
        uint256[] calldata originatedTxsFee
    ) external onlyDriver {
        sfc.sealEpoch(offlineTimes, offlineBlocks, uptimes, originatedTxsFee);
    }

    function isContract(address account) internal view returns (bool) {
        uint256 size;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            size := extcodesize(account)
        }
        // extcodesize returns 0 during a contract's own constructor, so a contract
        // calling this from its constructor will appear as an EOA. With CREATE2 the
        // target address is deterministic before deployment, so a pre-committed address
        // also returns 0 until the contract is actually deployed.
        return size > 0;
    }

    // Storage layout: sfc (1) + driver (1) + pendingMigration (1) + pendingMigrationUnlockTime (1)
    //   + pendingCopyCodeTarget (1) + pendingCopyCodeSource (1) + pendingCopyCodeUnlockTime (1) = 7 vars
    //   + 43 gap = 50 slots for future upgrades
    uint256[43] private __gap;
}

contract NodeDriver is Initializable {
    uint256 internal _deprecated_sfc_slot; // formerly: SFC internal sfc — slot preserved for storage layout
    NodeDriver internal backend;
    EVMWriter internal evmWriter;

    event UpdatedBackend(address indexed backend);

    function setBackend(address _backend) external onlyBackend {
        require(_backend != address(0), "invalid backend address");
        emit UpdatedBackend(_backend);
        backend = NodeDriver(_backend);
    }

    modifier onlyBackend() {
        require(msg.sender == address(backend), "caller is not the backend");
        _;
    }

    event UpdateValidatorWeight(uint256 indexed validatorID, uint256 weight);
    event UpdateValidatorPubkey(uint256 indexed validatorID, bytes pubkey);

    event UpdateNetworkRules(bytes diff);
    event UpdateNetworkVersion(uint256 version);
    event AdvanceEpochs(uint256 num);

    function initialize(address _backend, address _evmWriterAddress)
        external
        initializer
    {
        require(_backend != address(0), "invalid backend address");
        require(_evmWriterAddress != address(0), "invalid evmWriter address");

        backend = NodeDriver(_backend);
        emit UpdatedBackend(_backend);
        evmWriter = EVMWriter(_evmWriterAddress);
    }

    function setBalance(address acc, uint256 value) external onlyBackend {
        evmWriter.setBalance(acc, value);
    }

    function copyCode(address acc, address from) external onlyBackend {
        evmWriter.copyCode(acc, from);
    }

    function swapCode(address acc, address with) external onlyBackend {
        evmWriter.swapCode(acc, with);
    }

    function setStorage(
        address acc,
        bytes32 key,
        bytes32 value
    ) external onlyBackend {
        evmWriter.setStorage(acc, key, value);
    }

    function incNonce(address acc, uint256 diff) external onlyBackend {
        evmWriter.incNonce(acc, diff);
    }

    function updateNetworkRules(bytes calldata diff) external onlyBackend {
        emit UpdateNetworkRules(diff);
    }

    function updateNetworkVersion(uint256 version) external onlyBackend {
        emit UpdateNetworkVersion(version);
    }

    function advanceEpochs(uint256 num) external onlyBackend {
        emit AdvanceEpochs(num);
    }

    function updateValidatorWeight(uint256 validatorID, uint256 value)
        external
        onlyBackend
    {
        emit UpdateValidatorWeight(validatorID, value);
    }

    function updateValidatorPubkey(uint256 validatorID, bytes calldata pubkey)
        external
        onlyBackend
    {
        emit UpdateValidatorPubkey(validatorID, pubkey);
    }

    modifier onlyNode() {
        require(msg.sender == address(0), "not callable");
        _;
    }

    // Methods which are called only by the node

    function setGenesisValidator(
        address _auth,
        uint256 validatorID,
        bytes calldata pubkey,
        uint256 status,
        uint256 createdEpoch,
        uint256 createdTime,
        uint256 deactivatedEpoch,
        uint256 deactivatedTime
    ) external onlyNode {
        backend.setGenesisValidator(
            _auth,
            validatorID,
            pubkey,
            status,
            createdEpoch,
            createdTime,
            deactivatedEpoch,
            deactivatedTime
        );
    }

    function setGenesisDelegation(
        address delegator,
        uint256 toValidatorID,
        uint256 stake,
        uint256 lockedStake,
        uint256 lockupFromEpoch,
        uint256 lockupEndTime,
        uint256 lockupDuration,
        uint256 earlyUnlockPenalty,
        uint256 rewards
    ) external onlyNode {
        backend.setGenesisDelegation(
            delegator,
            toValidatorID,
            stake,
            lockedStake,
            lockupFromEpoch,
            lockupEndTime,
            lockupDuration,
            earlyUnlockPenalty,
            rewards
        );
    }

    function deactivateValidator(uint256 validatorID, uint256 status)
        external
        onlyNode
    {
        backend.deactivateValidator(validatorID, status);
    }

    function sealEpochValidators(uint256[] calldata nextValidatorIDs)
        external
        onlyNode
    {
        backend.sealEpochValidators(nextValidatorIDs);
    }

    function sealEpoch(
        uint256[] calldata offlineTimes,
        uint256[] calldata offlineBlocks,
        uint256[] calldata uptimes,
        uint256[] calldata originatedTxsFee
    ) external onlyNode {
        backend.sealEpoch(
            offlineTimes,
            offlineBlocks,
            uptimes,
            originatedTxsFee
        );
    }
}

interface EVMWriter {
    function setBalance(address acc, uint256 value) external;

    function copyCode(address acc, address from) external;

    function swapCode(address acc, address with) external;

    function setStorage(
        address acc,
        bytes32 key,
        bytes32 value
    ) external;

    function incNonce(address acc, uint256 diff) external;
}

contract StakersConstants {
    using SafeMath for uint256;

    uint256 internal constant OK_STATUS = 0;
    uint256 internal constant WITHDRAWN_BIT = 1;
    uint256 internal constant OFFLINE_BIT = 1 << 3;
    uint256 internal constant DOUBLESIGN_BIT = 1 << 7;
    uint256 internal constant CHEATER_MASK = DOUBLESIGN_BIT;

    function minSelfStake() public pure returns (uint256) {
        // 200000 VC
        return 200000 * 1e18;
    }

    function maxDelegatedRatio() public pure returns (uint256) {
        // 1600%
        return 16 * Decimal.unit();
    }

    function validatorCommission() public pure returns (uint256) {
        // 15%
        return Decimal.unit() * 15 / 100;
    }

    function contractCommission() public pure returns (uint256) {
        // 30% — protocol fee on tx rewards (independent of unlockedRewardRatio)
        return (30 * Decimal.unit()) / 100;
    }

    function unlockedRewardRatio() public pure returns (uint256) {
        // 30% — portion of base reward paid to unlocked stake (independent of contractCommission)
        return (30 * Decimal.unit()) / 100;
    }

    function minLockupDuration() public pure returns (uint256) {
        return 86400 * 14;
    }

    function maxLockupDuration() public pure returns (uint256) {
        return 86400 * 365;
    }

    function withdrawalPeriodEpochs() public pure returns (uint256) {
        return 6;
    }

    function withdrawalPeriodTime() public pure returns (uint256) {
        // 1 day
        return 60 * 60 * 24;
    }

    function withdrawalPeriodEpochsValidator() public pure returns (uint256) {
        return 6 * 30;
    }

    function withdrawalPeriodTimeValidator() public pure returns (uint256) {
        // 3 day
        return 86400 * 3;
    }

    function minDelegation() public pure returns (uint256) {
        // 0.01 VC
        return 1e16;
    }
}

contract Version {
    function version() external pure returns (bytes3) {
        // version 3.0.5
        return "305";
    }
}

// SFC storage layout (inherited slots, linearized C3 order):
//   Initializable:      slots 0-50    (2 bools packed in slot 0 + 50 gap = 51 slots)
//   Ownable:            slots 51-101  (_owner + _pendingOwner + _pendingOwnerDeadline + 48 gap = 51 slots)
//   StakersConstants:   0 slots       (pure functions only, no storage)
//   Version:            0 slots       (pure function only, no storage)
//   SFC own storage:    starts at slot 102
//
// PROXY UPGRADE COMPATIBILITY:
//   - ReentrancyGuard is NOT inherited (would insert 50 slots). Instead, _reentrancyGuardCounter
//     is an SFC-own variable at the end of storage. nonReentrant modifier is implemented inline.
//   - Original Ownable had: _owner (1 slot) + 50 gap = 51 slots.
//     Fixed Ownable uses:   _owner (1) + _pendingOwner (1) + _pendingOwnerDeadline (1) + 48 gap = 51 slots.
//     The 2 new Ownable vars consume 2 of the original 50-slot gap. Safe.
//   - Original SFC slot 104 was `address public genesisValidator` — preserved as `_legacyGenesisValidator`.
//     New `isGenesisValidator` mapping is added at the end of storage (gap slot).
//   - All new SFC variables (corruptedEpochs, correctedEpochRewardRate, isEpochCorrected,
//     correctionReasonHash, maxCorrectionDelta, pendingCorrections, pending* timelocks,
//     usedPubkeyHash, isGenesisValidator, _reentrancyGuardCounter) are appended AFTER
//     the last original variable (wrIdCount). Original slot ordering is preserved exactly.
contract SFC is Initializable, Ownable, StakersConstants, Version {
    using SafeMath for uint256;

    // Lock the implementation contract so it cannot be initialized directly.
    // The `initializer` modifier sets `initialized = true` in this contract's own
    // storage at deployment time, so calling `initialize()` on the bare implementation
    // address will always revert. Each proxy has independent storage where `initialized`
    // starts as false, so proxies are unaffected and can still be initialized normally.
    constructor() public initializer {
    }

    uint256 public constant MIN_OFFLINE_PENALTY_THRESHOLD_TIME = 20 minutes;
    uint256 public constant MIN_OFFLINE_PENALTY_THRESHOLD_BLOCKS_NUM = 20;
    uint256 public constant MAX_BASE_REWARD_PER_SECOND = 32967977168935185184;

    struct Validator {
        uint256 status;
        uint256 deactivatedTime;
        uint256 deactivatedEpoch;
        uint256 receivedStake;
        uint256 createdEpoch;
        uint256 createdTime;
        address auth;
    }

    NodeDriverAuth internal node;

    uint256 public currentSealedEpoch;
    // Preserved from original: `address public genesisValidator` — do not remove or change type.
    // This slot (104 relative to contract start) must remain an address for proxy upgrade safety.
    // Visibility is internal; the original ABI getter is preserved via genesisValidator() below.
    address internal _legacyGenesisValidator;
    mapping(uint256 => Validator) public getValidator;
    mapping(address => uint256) public getValidatorID;
    mapping(uint256 => bytes) public getValidatorPubkey;

    uint256 public lastValidatorID;
    uint256 public totalStake;
    uint256 public totalActiveStake;
    uint256 public totalSlashedStake;
    uint256 public totalPenalty;

    struct Rewards {
        uint256 lockupExtraReward;
        uint256 lockupBaseReward;
        uint256 unlockedReward;
    }

    mapping(address => mapping(uint256 => Rewards)) internal _rewardsStash; // addr, validatorID -> Rewards

    mapping(address => mapping(uint256 => uint256))
        public stashedRewardsUntilEpoch;

    struct WithdrawalRequest {
        uint256 epoch;
        uint256 time;
        uint256 amount;
    }

    mapping(address => mapping(uint256 => mapping(uint256 => WithdrawalRequest)))
        public getWithdrawalRequest;

    struct LockedDelegation {
        uint256 lockedStake;
        uint256 fromEpoch;
        uint256 endTime;
        uint256 duration;
    }

    mapping(address => mapping(uint256 => uint256)) public getStake;

    mapping(address => mapping(uint256 => LockedDelegation))
        public getLockupInfo;

    mapping(address => mapping(uint256 => Rewards))
        public getStashedLockupRewards;

    struct EpochSnapshot {
        mapping(uint256 => uint256) receivedStake;
        mapping(uint256 => uint256) accumulatedRewardPerToken;
        mapping(uint256 => uint256) accumulatedUptime;
        mapping(uint256 => uint256) accumulatedOriginatedTxsFee;
        mapping(uint256 => uint256) offlineTime;
        mapping(uint256 => uint256) offlineBlocks;
        uint256[] validatorIDs;
        uint256 endTime;
        uint256 epochFee;
        uint256 totalBaseRewardWeight;
        uint256 totalTxRewardWeight;
        uint256 baseRewardPerSecond;
        uint256 totalStake;
        uint256 totalSupply;
        mapping(uint256 => uint256) selfStake;
        mapping(uint256 => uint256) lockedSelfStake;
        mapping(uint256 => uint256) lockedSelfStakeDuration;
    }

    uint256 public baseRewardPerSecond;
    uint256 public totalSupply;
    mapping(uint256 => EpochSnapshot) public getEpochSnapshot;

    uint256 public offlinePenaltyThresholdBlocksNum;
    uint256 public offlinePenaltyThresholdTime;

    mapping(uint256 => uint256) public slashingRefundRatio; // validator ID -> (slashing refund ratio)

    // --- Original storage ends after wrIdCount (see below). ---
    // --- Do NOT insert new state variables above this line. ---

    struct StakeWithoutAmount {
        address delegator;
        uint96 timestamp;
        uint256 validatorId;
    }

    struct Stake {
        address delegator;
        uint96 timestamp;
        uint256 validatorId;
        uint256 amount;
    }

    StakeWithoutAmount[] internal stakes;
    mapping(address => mapping(uint256 => uint256)) internal stakePosition;

    mapping(address => mapping(uint256 => uint256)) internal wrIdCount;

    // =========================================================================
    // NEW VARIABLES (proxy-safe: appended after all original storage slots)
    // All variables below this line are new additions. They occupy slots that
    // were previously unused (no gap existed in original, so these extend storage).
    // =========================================================================

    mapping(uint256 => mapping(uint256 => bool)) public corruptedEpochs; // epoch => validatorID => corrupted

    // epoch => validatorID => correctedAccumulatedRewardPerToken
    mapping(uint256 => mapping(uint256 => uint256)) public correctedEpochRewardRate;

    mapping(uint256 => mapping(uint256 => bool)) public isEpochCorrected;

    // epoch => validatorID => keccak256(reason)
    mapping(uint256 => mapping(uint256 => bytes32)) public correctionReasonHash;

    uint256 public constant CORRECTION_TIMELOCK = 2 days;

    uint256 public maxCorrectionDelta;

    struct PendingCorrection {
        uint256 correctedAccumulatedRewardPerToken;
        string reason;
        uint256 unlockTime;
    }
    mapping(uint256 => mapping(uint256 => PendingCorrection)) internal pendingCorrections;
    // Tracks when a pending correction was last cancelled per (epoch, validatorID).
    // Prevents cancel-requeue abuse that would let the owner substitute the queued value
    // after delegators have already observed and planned around the original value.
    mapping(uint256 => mapping(uint256 => uint256)) public correctionCancelTime;

    // Accumulates the total positive upward drift ever applied to
    // correctedEpochRewardRate[epoch][validatorID] across all executed
    // corrections/revisions. Bounded by CUMULATIVE_CORRECTION_MULTIPLIER *
    // maxCorrectionDelta (enforced at execute time). Downward revisions do
    // not reduce the counter, so they cannot create budget for compensating
    // upward compounding later.
    mapping(uint256 => mapping(uint256 => uint256)) public totalCorrectionDelta;

    uint256 public pendingMaxCorrectionDelta;
    uint256 public pendingMaxCorrectionDeltaUnlockTime;

    uint256 public pendingBaseRewardPerSecond;
    uint256 public pendingBaseRewardPerSecondUnlockTime;

    uint256 public pendingOfflinePenaltyBlocksNum;
    uint256 public pendingOfflinePenaltyTime;
    uint256 public pendingOfflinePenaltyUnlockTime;

    struct PendingSlashingRefund {
        uint256 ratio;
        uint256 unlockTime;
    }
    mapping(uint256 => PendingSlashingRefund) public pendingSlashingRefundRatios;
    mapping(uint256 => uint256) public lastSlashingRefundRatioCancelledAt;

    mapping(bytes32 => bool) internal usedPubkeyHash;

    function isNode(address addr) internal view returns (bool) {
        return addr == address(node);
    }

    modifier onlyDriver() {
        require(
            isNode(msg.sender),
            "caller is not the NodeDriverAuth contract"
        );
        _;
    }

    event CreatedValidator(
        uint256 indexed validatorID,
        address indexed auth,
        uint256 createdEpoch,
        uint256 createdTime
    );
    event DeactivatedValidator(
        uint256 indexed validatorID,
        uint256 deactivatedEpoch,
        uint256 deactivatedTime
    );
    event ChangedValidatorStatus(uint256 indexed validatorID, uint256 status);
    event Delegated(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 amount
    );
    /// Emitted when an orphaned (delegator, validator) pair is back-registered
    /// into the `stakes[]` enumeration array. Orphans exist because the V1 SFC
    /// path that produced them updated `getStake[]` without pushing a matching
    /// `stakes[]` entry; V2 inherits that storage state across bytecode swaps.
    event RegisteredStake(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 position
    );
    event Undelegated(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 indexed wrID,
        uint256 amount
    );
    event Withdrawn(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 indexed wrID,
        uint256 amount
    );
    event CorruptionDetected(
        uint256 indexed toValidatorID,
        uint256 safeCursor,
        uint256 payableEpoch
    );
    event ClaimedRewards(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 lockupExtraReward,
        uint256 lockupBaseReward,
        uint256 unlockedReward
    );
    event RestakedRewards(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 lockupExtraReward,
        uint256 lockupBaseReward,
        uint256 unlockedReward
    );
    event LockedUpStake(
        address indexed delegator,
        uint256 indexed validatorID,
        uint256 duration,
        uint256 amount
    );
    event LockupExtended(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 oldLockedStake,
        uint256 newLockedStake,
        uint256 fromEpoch
    );
    event UnlockedStake(
        address indexed delegator,
        uint256 indexed validatorID,
        uint256 amount,
        uint256 penalty
    );
    event PenaltyApplied(
        address indexed delegator,
        uint256 indexed validatorID,
        uint256 penalty
    );
    event PenaltyUndelegated(
        address indexed delegator,
        uint256 indexed toValidatorID,
        uint256 amount
    );
    event UpdatedBaseRewardPerSec(uint256 oldValue, uint256 newValue);
    event UpdatedOfflinePenaltyThreshold(uint256 blocksNum, uint256 period);
    event UpdatedSlashingRefundRatio(
        uint256 indexed validatorID,
        uint256 refundRatio
    );
    event RefundedSlashedLegacyDelegation(
        address indexed delegator,
        uint256 indexed validatorID,
        uint256 amount
    );
    event EpochDataCorrupted(
        uint256 indexed validatorID,
        uint256 indexed fromEpoch,
        uint256 indexed toEpoch,
        uint256 stashedRate,
        uint256 currentRate
    );
    event EpochUncorrupted(uint256 indexed epoch, uint256 indexed validatorID);


    event CorrectionUpdateQueued(
        uint256 indexed epoch,
        uint256 indexed validatorID,
        uint256 correctedAccumulatedRewardPerToken,
        uint256 unlockTime,
        string reason
    );
    event CorrectionUpdateExecuted(
        uint256 indexed epoch,
        uint256 indexed validatorID,
        uint256 correctedAccumulatedRewardPerToken,
        string reason
    );
    event CorrectionUpdateCancelled(
        uint256 indexed epoch,
        uint256 indexed validatorID
    );
    event MaxCorrectionDeltaUpdated(uint256 oldValue, uint256 newValue);
    event MaxCorrectionDeltaQueued(uint256 newValue, uint256 unlockTime);
    event MaxCorrectionDeltaCancelled();
    // Emitted whenever a correction execution applies non-zero upward drift
    // to an (epoch, validatorID) pair. `increment` is the positive difference
    // between the new and prior corrected rate; `totalUpwardDelta` is the
    // updated running total post-increment. Observers can use this to track
    // cumulative governance impact on a single epoch's rate.
    event CumulativeCorrectionDeltaUpdated(
        uint256 indexed epoch,
        uint256 indexed validatorID,
        uint256 increment,
        uint256 totalUpwardDelta
    );
    event ReactivatedValidator(uint256 indexed validatorID);
    event BaseRewardPerSecQueued(uint256 newValue, uint256 unlockTime);
    event BaseRewardPerSecExecuted(uint256 oldValue, uint256 newValue);
    event BaseRewardPerSecCancelled();
    event EpochSealed(uint256 indexed epoch, uint256 endTime, uint256 baseRewardPerSecond, uint256 totalSupply);
    event RewardsStashed(address indexed delegator, uint256 indexed validatorID, uint256 epoch);

    /*
    Getters
    */

    function currentEpoch() public view returns (uint256) {
        return currentSealedEpoch.add(1);
    }

    function genesisValidator() public view returns (address) {
        return _legacyGenesisValidator;
    }

    function getEpochValidatorIDs(uint256 epoch)
        external
        view
        returns (uint256[] memory)
    {
        return getEpochSnapshot[epoch].validatorIDs;
    }

    function getEpochReceivedStake(uint256 epoch, uint256 validatorID)
        external
        view
        returns (uint256)
    {
        return getEpochSnapshot[epoch].receivedStake[validatorID];
    }

    // Returns the RAW per-epoch accumulator. Across a reactivation-healed offline gap this reads 0
    // for gap epochs; use getEffectiveRewardRate(epoch, validatorID) for the heal-aware value that
    // on-chain reward math uses when reconstructing delegator rewards.
    function getEpochAccumulatedRewardPerToken(
        uint256 epoch,
        uint256 validatorID
    ) external view returns (uint256) {
        return getEpochSnapshot[epoch].accumulatedRewardPerToken[validatorID];
    }

    function getEpochCorrectionInfo(uint256 epoch, uint256 validatorID)
        external
        view
        returns (bool isCorrected, uint256 correctedRate)
    {
        isCorrected = isEpochCorrected[epoch][validatorID];
        correctedRate = correctedEpochRewardRate[epoch][validatorID];
    }

    function getEffectiveRewardRate(uint256 epoch, uint256 validatorID)
        external
        view
        returns (uint256)
    {
        return _getEffectiveRewardRate(epoch, validatorID);
    }

    function getCorrectionReasonHash(uint256 epoch, uint256 validatorID)
        external
        view
        returns (bytes32)
    {
        return correctionReasonHash[epoch][validatorID];
    }

    function getPendingCorrection(uint256 epoch, uint256 validatorID)
        external
        view
        returns (uint256 correctedAccumulatedRewardPerToken, uint256 unlockTime, string memory reason)
    {
        PendingCorrection storage pc = pendingCorrections[epoch][validatorID];
        correctedAccumulatedRewardPerToken = pc.correctedAccumulatedRewardPerToken;
        unlockTime = pc.unlockTime;
        reason = pc.reason;
    }

    function getEpochAccumulatedUptime(uint256 epoch, uint256 validatorID)
        external
        view
        returns (uint256)
    {
        return getEpochSnapshot[epoch].accumulatedUptime[validatorID];
    }

    function getEpochAccumulatedOriginatedTxsFee(
        uint256 epoch,
        uint256 validatorID
    ) external view returns (uint256) {
        return getEpochSnapshot[epoch].accumulatedOriginatedTxsFee[validatorID];
    }

    function getEpochOfflineTime(uint256 epoch, uint256 validatorID)
        external
        view
        returns (uint256)
    {
        return getEpochSnapshot[epoch].offlineTime[validatorID];
    }

    function getEpochOfflineBlocks(uint256 epoch, uint256 validatorID)
        external
        view
        returns (uint256)
    {
        return getEpochSnapshot[epoch].offlineBlocks[validatorID];
    }

    function rewardsStash(address delegator, uint256 validatorID)
        external
        view
        returns (uint256)
    {
        Rewards memory stash = _rewardsStash[delegator][validatorID];
        return
            stash.lockupBaseReward.add(stash.lockupExtraReward).add(
                stash.unlockedReward
            );
    }

    function getLockedStake(address delegator, uint256 toValidatorID)
        public
        view
        returns (uint256)
    {
        if (!isLockedUp(delegator, toValidatorID)) {
            return 0;
        }
        return getLockupInfo[delegator][toValidatorID].lockedStake;
    }

    // Calculate actual return size to avoid trailing zero-initialized entries
    function getStakes(
        uint256 offset,
        uint256 limit
    ) external view returns (Stake[] memory) {
        require(limit <= 1000, "limit too large");
        uint256 length = stakes.length;
        if (offset >= length) {
            return new Stake[](0);
        }
        uint256 actualLimit = (offset.add(limit) > length) ? length.sub(offset) : limit;
        Stake[] memory stakes_ = new Stake[](actualLimit);
        for (uint256 i = 0; i < actualLimit; ) {
            uint256 idx = offset.add(i);
            address delegator = stakes[idx].delegator;
            uint256 validatorId = stakes[idx].validatorId;
            stakes_[i] = Stake({
                delegator: delegator,
                timestamp: stakes[idx].timestamp,
                validatorId: validatorId,
                amount: getStake[delegator][validatorId]
            });
            i = i.add(1);
        }
        return stakes_;
    }

    // Cap offset+limit to wrIdCount to avoid returning default-initialized structs
    function getWrRequests(
        address delegator,
        uint256 validatorID,
        uint256 offset,
        uint256 limit
    ) external view returns (WithdrawalRequest[] memory) {
        require(limit <= 1000, "limit too large");
        uint256 count = wrIdCount[delegator][validatorID];
        if (offset >= count) {
            return new WithdrawalRequest[](0);
        }
        uint256 actualLimit = (offset.add(limit) > count) ? count.sub(offset) : limit;
        WithdrawalRequest[] memory requests_ = new WithdrawalRequest[](actualLimit);
        for (uint256 i = 0; i < actualLimit; ) {
            requests_[i] = getWithdrawalRequest[delegator][validatorID][
                offset.add(i)
            ];
            i = i.add(1);
        }
        return requests_;
    }

    /*
    Constructor
    */

    function initialize(
        uint256 sealedEpoch,
        uint256 _totalSupply,
        address nodeDriver,
        address owner
    ) external initializer {
        require(nodeDriver != address(0), "invalid nodeDriver address");
        require(_totalSupply > 0, "totalSupply must be positive");

        Ownable.initialize(owner);
        _reentrancyGuardCounter = 1;
        currentSealedEpoch = sealedEpoch;
        node = NodeDriverAuth(nodeDriver);
        totalSupply = _totalSupply;
        baseRewardPerSecond = 0.93 * 1e18;
        require(baseRewardPerSecond <= MAX_BASE_REWARD_PER_SECOND, "too large reward per second");
        emit UpdatedBaseRewardPerSec(0, baseRewardPerSecond);
        offlinePenaltyThresholdBlocksNum = 120;
        offlinePenaltyThresholdTime = 2 hours;
        emit UpdatedOfflinePenaltyThreshold(offlinePenaltyThresholdBlocksNum, offlinePenaltyThresholdTime);
        maxCorrectionDelta = 1e14;
        emit MaxCorrectionDeltaUpdated(0, maxCorrectionDelta);
        getEpochSnapshot[sealedEpoch].endTime = _now();

        stakes.push(
            StakeWithoutAmount({
                delegator: address(0),
                validatorId: 0,
                timestamp: 0
            })
        );
    }

    function setGenesisValidator(
        address auth,
        uint256 validatorID,
        bytes calldata pubkey,
        uint256 status,
        uint256 createdEpoch,
        uint256 createdTime,
        uint256 deactivatedEpoch,
        uint256 deactivatedTime
    ) external onlyDriver {
        _rawCreateValidator(
            auth,
            validatorID,
            pubkey,
            status,
            createdEpoch,
            createdTime,
            deactivatedEpoch,
            deactivatedTime
        );
        if (validatorID > lastValidatorID) {
            lastValidatorID = validatorID;
        }
        // Track all genesis validators, not just the last one
        isGenesisValidator[auth] = true;
    }

    function setGenesisDelegation(
        address delegator,
        uint256 toValidatorID,
        uint256 stake,
        uint256 lockedStake,
        uint256 lockupFromEpoch,
        uint256 lockupEndTime,
        uint256 lockupDuration,
        uint256 earlyUnlockPenalty,
        uint256 rewards
    ) external onlyDriver {
        require(_validatorExists(toValidatorID), "validator doesn't exist");
        _rawDelegate(delegator, toValidatorID, stake);
        _rewardsStash[delegator][toValidatorID].unlockedReward = rewards;
        _mintNativeToken(stake);
        if (lockedStake != 0) {
            require(
                lockedStake <= stake,
                "locked stake is greater than the whole stake"
            );
            LockedDelegation storage ld = getLockupInfo[delegator][
                toValidatorID
            ];
            ld.lockedStake = lockedStake;
            ld.fromEpoch = lockupFromEpoch;
            ld.endTime = lockupEndTime;
            ld.duration = lockupDuration;
            /// @dev Intentionally seeds `getStashedLockupRewards.lockupExtraReward`
            /// only — no matching `_rewardsStash.lockupExtraReward` entry.
            /// `earlyUnlockPenalty` is the penalty basis, not a claimable
            /// reward; writing it only to the lockup-rewards record preserves
            /// the "what would be refunded if unlocked early" semantic without
            /// creating phantom claimable rewards.
            getStashedLockupRewards[delegator][toValidatorID]
                .lockupExtraReward = earlyUnlockPenalty;
            emit LockedUpStake(
                delegator,
                toValidatorID,
                lockupDuration,
                lockedStake
            );
        }
    }

    /*
    Methods
    */

    function createValidator(bytes calldata pubkey) external payable nonReentrant {
        require(msg.value >= minSelfStake(), "insufficient self-stake");
        // Lachesis-base pubkey wire format is [type(1) || raw(N)] with
        // type=0xc0 (Secp256k1) and raw being a 65-byte uncompressed
        // secp256k1 point (0x04 || X(32) || Y(32)). A pubkey missing the
        // 0xc0 type-byte makes the validator unverifiable on the consensus
        // layer (zero uptime, zero rewards, stuck delegations).
        require(pubkey.length == 66, "invalid pubkey length");
        require(pubkey[0] == 0xc0, "invalid pubkey type");
        _createValidator(msg.sender, pubkey);
        _delegate(msg.sender, lastValidatorID, msg.value);
    }

    function _createValidator(address auth, bytes memory pubkey) internal {
        lastValidatorID = lastValidatorID.add(1);
        uint256 validatorID = lastValidatorID;
        _rawCreateValidator(
            auth,
            validatorID,
            pubkey,
            OK_STATUS,
            currentEpoch(),
            _now(),
            0,
            0
        );
    }

    function _rawCreateValidator(
        address auth,
        uint256 validatorID,
        bytes memory pubkey,
        uint256 status,
        uint256 createdEpoch,
        uint256 createdTime,
        uint256 deactivatedEpoch,
        uint256 deactivatedTime
    ) internal {
        require(auth != address(0), "auth cannot be zero address");
        // See createValidator() for the lachesis-base pubkey format
        // contract. Centralised here so setGenesisValidator() inherits the
        // same rule via _rawCreateValidator.
        require(pubkey.length == 66, "invalid pubkey length");
        require(pubkey[0] == 0xc0, "invalid pubkey type");
        require(getValidatorID[auth] == 0, "validator already exists");
        require(getValidator[validatorID].createdTime == 0, "validator ID already used");
        bytes32 pkHash = keccak256(pubkey);
        require(!usedPubkeyHash[pkHash], "pubkey already registered");
        usedPubkeyHash[pkHash] = true;
        getValidatorID[auth] = validatorID;
        getValidator[validatorID].status = status;
        getValidator[validatorID].createdEpoch = createdEpoch;
        getValidator[validatorID].createdTime = createdTime;
        getValidator[validatorID].deactivatedTime = deactivatedTime;
        getValidator[validatorID].deactivatedEpoch = deactivatedEpoch;
        getValidator[validatorID].auth = auth;
        getValidatorPubkey[validatorID] = pubkey;

        emit CreatedValidator(validatorID, auth, createdEpoch, createdTime);
        if (deactivatedEpoch != 0) {
            emit DeactivatedValidator(
                validatorID,
                deactivatedEpoch,
                deactivatedTime
            );
        }
        if (status != 0) {
            emit ChangedValidatorStatus(validatorID, status);
        }
    }

    function getSelfStake(uint256 validatorID) public view returns (uint256) {
        return getStake[getValidator[validatorID].auth][validatorID];
    }

    function _checkDelegatedStakeLimit(uint256 validatorID)
        internal
        view
        returns (bool)
    {
        return
            getValidator[validatorID].receivedStake <=
            getSelfStake(validatorID).mul(maxDelegatedRatio()).div(
                Decimal.unit()
            );
    }

    function delegate(uint256 toValidatorID) external payable nonReentrant {
        _delegate(msg.sender, toValidatorID, msg.value);
    }

    function _delegate(
        address delegator,
        uint256 toValidatorID,
        uint256 amount
    ) internal {
        require(_validatorExists(toValidatorID), "validator doesn't exist");
        require(
            getValidator[toValidatorID].status == OK_STATUS,
            "validator isn't active"
        );
        // Enforce minimum delegation for all non-genesis delegations.
        // setGenesisDelegation calls _rawDelegate directly and bypasses this check,
        // which is intentional — genesis stakes may be smaller than the live minimum.
        require(amount >= minDelegation(), "delegation amount too small");
        _rawDelegate(delegator, toValidatorID, amount);
        require(
            _checkDelegatedStakeLimit(toValidatorID),
            "validator's delegations limit is exceeded"
        );
    }

    function _rawDelegate(
        address delegator,
        uint256 toValidatorID,
        uint256 amount
    ) internal {
        require(delegator != address(0), "delegator cannot be zero address");
        require(amount > 0, "zero amount");
        require(block.timestamp <= 2**96 - 1, "timestamp overflow for uint96");

        // Initialize the reward cursor for a never-before-seen delegation BEFORE
        // stashing. Without this, stashedRewardsUntilEpoch starts at 0 and the
        // cursor can only advance MAX_CORRUPTION_CHECK_EPOCHS per _stashRewards
        // call. For a delegator who joins after genesis, that strands the cursor
        // in the all-zero-accumulatedRewardPerToken dead zone below the
        // validator's createdEpoch: claimRewards/restakeRewards revert
        // "zero rewards" while pendingRewards() (a view) integrates the full
        // range and over-reports. Seeding the cursor at currentSealedEpoch makes
        // the first delegation start accruing from the current sealed epoch, the
        // same point _stashRewards would (correctly) settle a delegation that
        // already had history. The getStake==0 && cursor==0 guard ensures we only
        // seed a genuine first delegation and never clobber a re-delegation that
        // already carries a non-zero cursor.
        if (
            getStake[delegator][toValidatorID] == 0 &&
            stashedRewardsUntilEpoch[delegator][toValidatorID] == 0
        ) {
            stashedRewardsUntilEpoch[delegator][toValidatorID] = currentSealedEpoch;
        }

        _stashRewards(delegator, toValidatorID);

        uint256 stakePos = stakePosition[delegator][toValidatorID];
        if (stakePos == 0) {
            stakePosition[delegator][toValidatorID] = stakes.length;
            stakes.push(
                StakeWithoutAmount({
                    delegator: delegator,
                    timestamp: uint96(block.timestamp),
                    validatorId: toValidatorID
                })
            );
        } else {
            stakes[stakePos].timestamp = uint96(block.timestamp);
        }

        getStake[delegator][toValidatorID] = getStake[delegator][toValidatorID]
            .add(amount);
        uint256 origStake = getValidator[toValidatorID].receivedStake;
        getValidator[toValidatorID].receivedStake = origStake.add(amount);
        totalStake = totalStake.add(amount);
        if (getValidator[toValidatorID].status == OK_STATUS) {
            totalActiveStake = totalActiveStake.add(amount);
        }

        _syncValidator(toValidatorID, origStake == 0);

        emit Delegated(delegator, toValidatorID, amount);
    }

    function _setValidatorDeactivated(uint256 validatorID, uint256 status)
        internal
    {
        if (
            getValidator[validatorID].status == OK_STATUS && status != OK_STATUS
        ) {
            totalActiveStake = totalActiveStake.sub(
                getValidator[validatorID].receivedStake
            );
        }
        // status as a number is proportional to severity
        if (status > getValidator[validatorID].status) {
            getValidator[validatorID].status = status;
            if (getValidator[validatorID].deactivatedEpoch == 0) {
                getValidator[validatorID].deactivatedEpoch = currentEpoch();
                getValidator[validatorID].deactivatedTime = _now();
                emit DeactivatedValidator(
                    validatorID,
                    getValidator[validatorID].deactivatedEpoch,
                    getValidator[validatorID].deactivatedTime
                );
            }
            emit ChangedValidatorStatus(validatorID, status);
        }
    }

    function _rawUndelegate(
        address delegator,
        uint256 toValidatorID,
        uint256 amount
    ) internal {
        getStake[delegator][toValidatorID] = getStake[delegator][toValidatorID].sub(amount);
        getValidator[toValidatorID].receivedStake = getValidator[toValidatorID]
            .receivedStake
            .sub(amount);
        totalStake = totalStake.sub(amount);

        if (getStake[delegator][toValidatorID] == 0) {
            uint256 stakePos = stakePosition[delegator][toValidatorID];
            // Orphaned entries (getStake > 0 but stakePosition == 0) exist on
            // mainnet/testnet for legacy V1-era stakes. Skipping _removeStake
            // for them unblocks full undelegate-to-zero; the sentinel guard in
            // _removeStake still protects against accidental position-0 removal
            // for non-orphaned entries.
            if (stakePos != 0) {
                _removeStake(stakePos);
            }
        }

        if (getValidator[toValidatorID].status == OK_STATUS) {
            totalActiveStake = totalActiveStake.sub(amount);
        }

        uint256 selfStakeAfterwards = getSelfStake(toValidatorID);
        if (selfStakeAfterwards != 0) {
            if (getValidator[toValidatorID].status == OK_STATUS) {
                require(
                    selfStakeAfterwards >= minSelfStake(),
                    "insufficient self-stake"
                );
                require(
                    _checkDelegatedStakeLimit(toValidatorID),
                    "validator's delegations limit is exceeded"
                );
            }
        } else {
            _setValidatorDeactivated(toValidatorID, WITHDRAWN_BIT);
        }
    }

    function _removeStake(uint256 position) internal {
        uint256 stakesLength = stakes.length;
        require(position < stakesLength, "invalid stake position");
        require(position != 0, "cannot remove sentinel stake entry");

        address removedDelegator = stakes[position].delegator;
        uint256 removedValidatorId = stakes[position].validatorId;

        uint256 lastPos = stakesLength.sub(1);
        if (position != lastPos) {
            stakes[position] = stakes[lastPos];
            stakePosition[stakes[position].delegator][
                stakes[position].validatorId
            ] = position;
        }
        stakes.pop();

        stakePosition[removedDelegator][removedValidatorId] = 0;
    }

    // Permissionless self-registration of an orphaned (msg.sender, toValidatorID)
    // pair into the `stakes[]` enumeration array.
    //
    // An orphan is a delegation where `getStake[delegator][toValidatorID] > 0`
    // but `stakePosition[delegator][toValidatorID] == 0` (no entry in stakes[]).
    // Orphans exist on both mainnet and testnet for delegations made under V1
    // SFC code paths that did not push to stakes[]. They are functionally
    // affected in two ways: (1) they are hidden from `getStakes()` enumeration,
    // (2) a full undelegate to zero would have reverted on _removeStake(0)
    // (this revert is fixed in the companion change to _rawUndelegate).
    //
    // Anyone with an orphaned stake may call this to publish themselves. The
    // recorded timestamp reflects the registration block, not the original
    // delegation block — the original timestamp is unrecoverable on-chain.
    function registerStake(uint256 toValidatorID) external nonReentrant {
        address delegator = msg.sender;
        require(getStake[delegator][toValidatorID] > 0, "no stake to register");
        require(
            stakePosition[delegator][toValidatorID] == 0,
            "stake already registered"
        );
        require(block.timestamp <= 2**96 - 1, "timestamp overflow for uint96");

        uint256 position = stakes.length;
        stakePosition[delegator][toValidatorID] = position;
        stakes.push(
            StakeWithoutAmount({
                delegator: delegator,
                timestamp: uint96(block.timestamp),
                validatorId: toValidatorID
            })
        );
        emit RegisteredStake(delegator, toValidatorID, position);
    }

    // Owner-only bulk back-fill for orphaned (delegator, validator) pairs.
    //
    // Equivalent to a sequence of registerStake() calls performed on behalf of
    // affected users so the explorer enumeration and the orphan-aware
    // _rawUndelegate guard converge without requiring every user to send a
    // transaction. Skips any pair that is already registered or whose stake
    // is zero, so the same call list is safe to retry on partial failure.
    //
    // MAX_BACKFILL_BATCH bounds the loop to keep a single call well below the
    // block gas limit; ops should split larger lists into multiple calls.
    function backfillStakes(
        address[] calldata delegators,
        uint256[] calldata validatorIDs
    ) external onlyOwner {
        uint256 length = delegators.length;
        require(length == validatorIDs.length, "mismatched array lengths");
        require(length <= MAX_BACKFILL_BATCH, "batch too large");
        require(block.timestamp <= 2**96 - 1, "timestamp overflow for uint96");

        for (uint256 i = 0; i < length; ) {
            address delegator = delegators[i];
            uint256 toValidatorID = validatorIDs[i];
            if (
                getStake[delegator][toValidatorID] > 0 &&
                stakePosition[delegator][toValidatorID] == 0
            ) {
                uint256 position = stakes.length;
                stakePosition[delegator][toValidatorID] = position;
                stakes.push(
                    StakeWithoutAmount({
                        delegator: delegator,
                        timestamp: uint96(block.timestamp),
                        validatorId: toValidatorID
                    })
                );
                emit RegisteredStake(delegator, toValidatorID, position);
            }
            i = i.add(1);
        }
    }

    uint256 internal constant MAX_BACKFILL_BATCH = 200;

    function undelegate(
        uint256 toValidatorID,
        uint256 amount
    ) external nonReentrant {
        address delegator = msg.sender;

        _stashRewards(delegator, toValidatorID);

        // Check for reward rate corruption — emit warning but do not block undelegation.
        // The stashRewards call above already handles incremental cursor advancement.
        uint256 payableEpoch = _highestPayableEpoch(toValidatorID);
        uint256 safeCursor = _safeCursorPosition(delegator, toValidatorID, payableEpoch);
        if (safeCursor < payableEpoch) {
            emit CorruptionDetected(toValidatorID, safeCursor, payableEpoch);
        }

        require(amount > 0, "zero amount");
        require(
            amount <= getUnlockedStake(delegator, toValidatorID),
            "not enough unlocked stake"
        );

        uint256 wrID = wrIdCount[delegator][toValidatorID];
        wrIdCount[delegator][toValidatorID] = wrID.add(1);

        _rawUndelegate(delegator, toValidatorID, amount);

        getWithdrawalRequest[delegator][toValidatorID][wrID].amount = amount;
        getWithdrawalRequest[delegator][toValidatorID][wrID]
            .epoch = currentEpoch();
        getWithdrawalRequest[delegator][toValidatorID][wrID].time = _now();

        _syncValidator(toValidatorID, false);

        emit Undelegated(delegator, toValidatorID, wrID, amount);
    }

    function isSlashed(uint256 validatorID) public view returns (bool) {
        return (getValidator[validatorID].status & CHEATER_MASK) != 0;
    }

    function getSlashingPenalty(
        uint256 amount,
        bool isCheater,
        uint256 refundRatio
    ) internal pure returns (uint256 penalty) {
        if (!isCheater || refundRatio >= Decimal.unit()) {
            return 0;
        }
        // round penalty upwards (ceiling) to prevent dust amount attacks
        uint256 numerator = amount.mul(Decimal.unit().sub(refundRatio));
        penalty = numerator.div(Decimal.unit());
        if (numerator.mod(Decimal.unit()) > 0) {
            penalty = penalty.add(1);
        }
        if (penalty > amount) {
            return amount;
        }
        return penalty;
    }

    // Slashing penalty design: the penalty is assessed at withdrawal time via
    // isSlashed(), not at undelegation time. This means any slash that lands
    // between undelegate() and withdraw() is captured. The only theoretical
    // gap is a withdraw() in the block immediately before the cheater evidence
    // block — a one-block window (~1-2s). This is accepted because:
    // (a) cheater evidence is consensus-driven, not observable in the mempool,
    // (b) the 6-epoch + 1-day withdrawal delay far exceeds the evidence processing
    //     time (~1 block), and
    // (c) the delegator cannot know a slash is imminent to time the withdrawal.
    function withdraw(uint256 toValidatorID, uint256 wrID) external nonReentrant {
        address payable delegator = msg.sender;
        WithdrawalRequest memory request = getWithdrawalRequest[delegator][toValidatorID][wrID];
        require(request.epoch != 0, "request doesn't exist");

        // Refactored to avoid stack too deep
        _checkWithdrawalEligibility(delegator, toValidatorID, request);

        uint256 amount = request.amount;
        uint256 penalty = _calculateAndApplyWithdrawalPenalty(toValidatorID, amount);

        delete getWithdrawalRequest[delegator][toValidatorID][wrID];

        uint256 withdrawable = amount.sub(penalty);
        if (withdrawable > 0) {
            // Gas cap of 50000 covers smart-contract wallets while preventing gas griefing
            (bool sent, ) = delegator.call.value(withdrawable).gas(50000)("");
            require(sent, "Failed to send VC");
        }

        emit Withdrawn(delegator, toValidatorID, wrID, amount);
    }

    function _checkWithdrawalEligibility(
        address delegator,
        uint256 toValidatorID,
        WithdrawalRequest memory request
    ) internal view {
        uint256 requestTime = request.time;
        uint256 requestEpoch = request.epoch;

        uint256 wPeriodTime;
        uint256 wPeriodEpochs;
        // Extended cooling-off applies only when the delegator is the auth of the specific
        // validator they are withdrawing from (i.e., withdrawing their own validator's stake).
        // Using getValidatorID[delegator] != 0 was too broad: it granted the 3-day/180-epoch
        // window to any ex-validator withdrawing from any other validator — including fully
        // deactivated/withdrawn ones with no current validator responsibilities.
        if (getValidator[toValidatorID].auth == delegator) {
            wPeriodTime = withdrawalPeriodTimeValidator();
            wPeriodEpochs = withdrawalPeriodEpochsValidator();
        } else {
            wPeriodTime = withdrawalPeriodTime();
            wPeriodEpochs = withdrawalPeriodEpochs();
        }

        // Only credit the validator's deactivation time when it actually reduces (not
        // eliminates) the cooling-off wait.  A validator deactivated long before the
        // undelegate call (deactivatedTime + wPeriodTime <= requestTime) would push the
        // deadline into the past, letting the delegator withdraw instantly — that is the
        // bypass this guard prevents.
        if (
            getValidator[toValidatorID].deactivatedTime != 0 &&
            getValidator[toValidatorID].deactivatedTime < requestTime &&
            getValidator[toValidatorID].deactivatedTime.add(wPeriodTime) > requestTime
        ) {
            requestTime = getValidator[toValidatorID].deactivatedTime;
            requestEpoch = getValidator[toValidatorID].deactivatedEpoch;
        }

        require(_now() >= requestTime.add(wPeriodTime), "not enough time passed");
        require(currentEpoch() >= requestEpoch.add(wPeriodEpochs), "not enough epochs passed");
    }

    function _calculateAndApplyWithdrawalPenalty(
        uint256 toValidatorID,
        uint256 amount
    ) internal returns (uint256) {
        bool isCheater = isSlashed(toValidatorID);
        uint256 penalty = getSlashingPenalty(amount, isCheater, slashingRefundRatio[toValidatorID]);

        if (penalty != 0) {
            totalSlashedStake = totalSlashedStake.add(penalty);
            totalPenalty = totalPenalty.add(penalty);
        }

        return penalty;
    }

    function deactivateValidator(uint256 validatorID, uint256 status)
        external
        onlyDriver
    {
        require(_validatorExists(validatorID), "validator doesn't exist");
        require(status != OK_STATUS, "wrong status");

        _setValidatorDeactivated(validatorID, status);
        _syncValidator(validatorID, false);
    }

    function _calcRawValidatorEpochBaseReward(
        uint256 epochDuration,
        uint256 _baseRewardPerSecond,
        uint256 baseRewardWeight,
        uint256 totalBaseRewardWeight
    ) internal pure returns (uint256) {
        if (baseRewardWeight == 0 || totalBaseRewardWeight == 0) {
            return 0;
        }
        uint256 totalReward = epochDuration.mul(_baseRewardPerSecond);
        return totalReward.mul(baseRewardWeight).div(totalBaseRewardWeight);
    }

    function _calcRawValidatorEpochTxReward(
        uint256 epochFee,
        uint256 txRewardWeight,
        uint256 totalTxRewardWeight
    ) internal pure returns (uint256) {
        if (txRewardWeight == 0 || totalTxRewardWeight == 0) {
            return 0;
        }
        // Combine multiplications before dividing to avoid precision loss from two sequential integer divisions.
        // epochFee (≤1e24 wei) × txRewardWeight (≤1e20) × commission_factor (≤1e18) ≈ 1e62, safe within uint256.
        return epochFee.mul(txRewardWeight).mul(Decimal.unit().sub(contractCommission())).div(
            totalTxRewardWeight.mul(Decimal.unit())
        );
    }

    function _calcValidatorCommission(uint256 rawReward, uint256 commission)
        internal
        pure
        returns (uint256)
    {
        return rawReward.mul(commission).div(Decimal.unit());
    }

    function _highestPayableEpoch(uint256 validatorID)
        internal
        view
        returns (uint256)
    {
        // deactivatedEpoch is zeroed by reactivateValidator, so an active validator
        // always returns currentSealedEpoch. A non-OK status alone does not cap rewards;
        // the cap is enforced exclusively via deactivatedEpoch.
        if (getValidator[validatorID].deactivatedEpoch != 0) {
            if (
                currentSealedEpoch < getValidator[validatorID].deactivatedEpoch
            ) {
                return currentSealedEpoch;
            }
            return getValidator[validatorID].deactivatedEpoch;
        }
        return currentSealedEpoch;
    }

    // find highest epoch such that _isLockedUpAtEpoch returns true (using binary search)
    function _highestLockupEpoch(address delegator, uint256 validatorID)
        internal
        view
        returns (uint256)
    {
        uint256 l = getLockupInfo[delegator][validatorID].fromEpoch;
        uint256 r = currentSealedEpoch;
        if (_isLockedUpAtEpoch(delegator, validatorID, r)) {
            return r;
        }
        if (!_isLockedUpAtEpoch(delegator, validatorID, l)) {
            return 0;
        }
        if (l > r) {
            return 0;
        }
        while (l < r) {
            uint256 m = l.add(r.sub(l).div(2));
            if (_isLockedUpAtEpoch(delegator, validatorID, m)) {
                l = m.add(1);
            } else {
                r = m;
            }
        }
        if (r == 0) {
            return 0;
        }
        return r.sub(1);
    }

    function _scaleLockupReward(uint256 fullReward, uint256 lockupDuration)
        internal
        pure
        returns (Rewards memory reward)
    {
        reward = Rewards(0, 0, 0);
        if (lockupDuration != 0) {
            uint256 maxLockupExtraRatio = Decimal.unit().sub(
                unlockedRewardRatio()
            );
            uint256 lockupExtraRatio = maxLockupExtraRatio
                .mul(lockupDuration)
                .div(maxLockupDuration());
            uint256 totalScaledReward = fullReward
                .mul(unlockedRewardRatio().add(lockupExtraRatio))
                .div(Decimal.unit());
            reward.lockupBaseReward = fullReward.mul(unlockedRewardRatio()).div(
                Decimal.unit()
            );
            reward.lockupExtraReward = totalScaledReward.sub(
                reward.lockupBaseReward
            );
        } else {
            reward.unlockedReward = fullReward.mul(unlockedRewardRatio()).div(
                Decimal.unit()
            );
        }
        return reward;
    }

    function sumRewards(Rewards memory a, Rewards memory b)
        internal
        pure
        returns (Rewards memory)
    {
        return
            Rewards(
                a.lockupExtraReward.add(b.lockupExtraReward),
                a.lockupBaseReward.add(b.lockupBaseReward),
                a.unlockedReward.add(b.unlockedReward)
            );
    }

    function sumRewards(
        Rewards memory a,
        Rewards memory b,
        Rewards memory c
    ) internal pure returns (Rewards memory) {
        return sumRewards(sumRewards(a, b), c);
    }

    function _newRewards(address delegator, uint256 toValidatorID)
        internal
        view
        returns (Rewards memory)
    {
        return _newRewardsUpTo(delegator, toValidatorID, _highestPayableEpoch(toValidatorID));
    }

    function _newRewardsUpTo(address delegator, uint256 toValidatorID, uint256 payableUntil)
        internal
        view
        returns (Rewards memory)
    {
        uint256 stashedUntil = stashedRewardsUntilEpoch[delegator][
            toValidatorID
        ];
        uint256 lockedUntil = _highestLockupEpoch(delegator, toValidatorID);
        if (lockedUntil > payableUntil) {
            lockedUntil = payableUntil;
        }
        if (lockedUntil < stashedUntil) {
            lockedUntil = stashedUntil;
        }

        LockedDelegation storage ld = getLockupInfo[delegator][toValidatorID];
        uint256 wholeStake = getStake[delegator][toValidatorID];
        // Cap lockedStake to wholeStake to prevent underflow if stake was partially slashed
        uint256 effectiveLockedStake = ld.lockedStake > wholeStake ? wholeStake : ld.lockedStake;
        uint256 unlockedStake = wholeStake.sub(effectiveLockedStake);
        uint256 fullReward;

        // count reward for locked stake during lockup epochs
        fullReward = _newRewardsOf(
            effectiveLockedStake,
            toValidatorID,
            stashedUntil,
            lockedUntil
        );
        Rewards memory plReward = _scaleLockupReward(fullReward, ld.duration);
        // count reward for unlocked stake during lockup epochs
        fullReward = _newRewardsOf(
            unlockedStake,
            toValidatorID,
            stashedUntil,
            lockedUntil
        );
        Rewards memory puReward = _scaleLockupReward(fullReward, 0);
        // count lockup reward for unlocked stake during unlocked epochs
        fullReward = _newRewardsOf(
            wholeStake,
            toValidatorID,
            lockedUntil,
            payableUntil
        );
        Rewards memory wuReward = _scaleLockupReward(fullReward, 0);

        return sumRewards(plReward, puReward, wuReward);
    }

    function _newRewardsOf(
        uint256 stakeAmount,
        uint256 toValidatorID,
        uint256 fromEpoch,
        uint256 toEpoch
    ) internal view returns (uint256) {
        if (fromEpoch >= toEpoch) {
            return 0;
        }

        // Use corrected rate if epoch was corrected, otherwise original snapshot rate
        uint256 stashedRate = _getEffectiveRewardRate(fromEpoch, toValidatorID);
        uint256 currentRate = _getEffectiveRewardRate(toEpoch, toValidatorID);

        // Return 0 if data is corrupted and not yet corrected
        if (currentRate < stashedRate) {
            return 0;
        }

        return
            currentRate.sub(stashedRate).mul(stakeAmount).div(Decimal.unit());
    }

    // Uses corrected rate if available
    function _getEffectiveRewardRate(uint256 epoch, uint256 validatorID)
        internal
        view
        returns (uint256)
    {
        if (isEpochCorrected[epoch][validatorID]) {
            return correctedEpochRewardRate[epoch][validatorID];
        }
        uint256 raw = getEpochSnapshot[epoch].accumulatedRewardPerToken[validatorID];
        // Heal reactivation gaps: across a validator's offline gap the raw rate is 0, which would
        // invert the monotonic index. Carry the captured pre-gap rate R forward for gap epochs so
        // the cursor scan (_safeCursorPosition) and reward math (_newRewardsOf) see a non-decreasing
        // stream. Applies ONLY where a floor is set AND epoch >= reactivationHealFrom AND raw < floor,
        // so post-re-entry epochs (raw >= R) and pre-gap/unrelated epochs are untouched. Limitation:
        // because records are never cleared, a hypothetical post-re-entry corruption that dropped the
        // raw rate BELOW the old floor R would be clamped up to R (masked toward the last-known-good
        // pre-gap value); inversions at or above R are unaffected. isEpochCorrected takes precedence.
        uint256 floorRate = reactivationHealFloor[validatorID];
        if (floorRate != 0 && epoch >= reactivationHealFrom[validatorID] && raw < floorRate) {
            return floorRate;
        }
        return raw;
    }

    // Reseed base for a validator's re-entry epoch in _sealEpoch_rewards. Normally the raw
    // prevSnapshot accumulator; but if the validator is re-entering after a healed offline gap
    // (prevSnapshot is a gap epoch holding 0 while a heal floor R is set), build from R instead
    // so the monotonic index never dips below its pre-gap value. Kept as a separate frame so the
    // seal loop stays within the EVM stack limit. Mirrors the read-side floor in
    // _getEffectiveRewardRate; does NOT route through isEpochCorrected (reseed semantics unchanged
    // for all non-heal validators, for whom reactivationHealFloor is 0 and rawBase is returned).
    // Interaction note: rawBase is the raw prevSnapshot value, so if the owner correction pipeline
    // had corrected the re-entry base (gap) epoch to some C != R, the reseed would still build from
    // R, not C. That requires a conflicting owner action on a gap epoch the source-heal already
    // makes monotonic and is not expected in practice; documented for completeness.
    function _healedReseedBase(uint256 validatorID, uint256 rawBase)
        internal
        view
        returns (uint256)
    {
        uint256 reseedFloor = reactivationHealFloor[validatorID];
        if (
            reseedFloor != 0 &&
            currentSealedEpoch >= reactivationHealFrom[validatorID] &&
            rawBase < reseedFloor
        ) {
            return reseedFloor;
        }
        return rawBase;
    }

    function _pendingRewards(address delegator, uint256 toValidatorID)
        internal
        view
        returns (Rewards memory)
    {
        Rewards memory reward = _newRewards(delegator, toValidatorID);
        return sumRewards(_rewardsStash[delegator][toValidatorID], reward);
    }

    function pendingRewards(address delegator, uint256 toValidatorID)
        external
        view
        returns (uint256)
    {
        Rewards memory reward = _pendingRewards(delegator, toValidatorID);
        return
            reward.unlockedReward.add(reward.lockupBaseReward).add(
                reward.lockupExtraReward
            );
    }

    uint256 internal constant MAX_CORRUPTION_CHECK_EPOCHS = 100;

    function checkAndLogEpochCorruption(uint256 toValidatorID, uint256 fromEpoch, uint256 toEpoch) external onlyOwner {
        require(_validatorExists(toValidatorID), "validator doesn't exist");
        _checkAndLogEpochCorruptionRange(toValidatorID, fromEpoch, toEpoch);
    }

    function _checkAndLogEpochCorruptionRange(uint256 toValidatorID, uint256 fromEpoch, uint256 toEpoch) internal {
        if (currentSealedEpoch == 0) {
            return;
        }

        require(fromEpoch <= toEpoch, "invalid epoch range");
        if (toEpoch > currentSealedEpoch) {
            toEpoch = currentSealedEpoch;
        }

        // Also check the transition INTO fromEpoch (fromEpoch-1 → fromEpoch), which
        // would be missed if the caller passes fromEpoch as the first suspect epoch.
        uint256 loopStart = (fromEpoch > 0) ? fromEpoch.sub(1) : fromEpoch;
        // Cap relative to loopStart so the loop body never exceeds MAX_CORRUPTION_CHECK_EPOCHS
        // boundary checks (each iteration checks one epoch pair).
        uint256 endEpoch = toEpoch;
        if (endEpoch > loopStart.add(MAX_CORRUPTION_CHECK_EPOCHS)) {
            endEpoch = loopStart.add(MAX_CORRUPTION_CHECK_EPOCHS);
        }
        for (uint256 epoch = loopStart; epoch < endEpoch; epoch++) {
            uint256 nextEpoch = epoch.add(1);
            // Both sides use the effective rate so that (a) corrections applied to earlier epochs
            // are reflected when checking subsequent ones (without this a partial raw recovery —
            // epoch N+1 raw > epoch N raw but < corrected epoch N — would go undetected, deadlocking
            // corrections), and (b) a reactivation-healed gap (raw 0 but the effective rate carried
            // forward to the pre-gap R) is not flagged as a false-positive corruption after every
            // self-reactivation.
            uint256 currentRate = _getEffectiveRewardRate(nextEpoch, toValidatorID);
            uint256 prevRate = _getEffectiveRewardRate(epoch, toValidatorID);

            if (currentRate < prevRate) {
                if (!corruptedEpochs[nextEpoch][toValidatorID]) {
                    corruptedEpochs[nextEpoch][toValidatorID] = true;
                }
                // Re-emit even if already flagged: prevRate evolves as earlier epochs are
                // corrected, so subsequent calls may report a different (more accurate)
                // prevRate/currentRate pair that is useful for off-chain monitoring.
                emit EpochDataCorrupted(toValidatorID, epoch, nextEpoch, prevRate, currentRate);
            }
        }
    }

    function stashRewards(address delegator, uint256 toValidatorID) external nonReentrant {
        // Prevent gas griefing: reject stashRewards for zero-stake delegator/validator pairs
        require(getStake[delegator][toValidatorID] > 0, "no stake");
        require(_stashRewards(delegator, toValidatorID), "nothing to stash");
        emit RewardsStashed(delegator, toValidatorID, stashedRewardsUntilEpoch[delegator][toValidatorID]);
    }

    function _stashRewards(address delegator, uint256 toValidatorID)
        internal
        returns (bool updated)
    {
        uint256 payableEpoch = _highestPayableEpoch(toValidatorID);
        uint256 safeCursor = _safeCursorPosition(delegator, toValidatorID, payableEpoch);

        Rewards memory nonStashedReward = _newRewardsUpTo(delegator, toValidatorID, safeCursor);
        // Only write cursor to storage if it has advanced, avoiding unnecessary gas on no-op calls.
        if (safeCursor != stashedRewardsUntilEpoch[delegator][toValidatorID]) {
            stashedRewardsUntilEpoch[delegator][toValidatorID] = safeCursor;
        }
        _rewardsStash[delegator][toValidatorID] = sumRewards(
            _rewardsStash[delegator][toValidatorID],
            nonStashedReward
        );
        // Only accumulate the lockup-specific reward components. unlockedReward is
        // irrelevant to the early-exit penalty and would inflate the mapping unboundedly.
        getStashedLockupRewards[delegator][toValidatorID].lockupExtraReward =
            getStashedLockupRewards[delegator][toValidatorID].lockupExtraReward
            .add(nonStashedReward.lockupExtraReward);
        getStashedLockupRewards[delegator][toValidatorID].lockupBaseReward =
            getStashedLockupRewards[delegator][toValidatorID].lockupBaseReward
            .add(nonStashedReward.lockupBaseReward);
        if (!isLockedUp(delegator, toValidatorID)) {
            delete getLockupInfo[delegator][toValidatorID];
            delete getStashedLockupRewards[delegator][toValidatorID];
        }
        return
            nonStashedReward.lockupBaseReward != 0 ||
            nonStashedReward.lockupExtraReward != 0 ||
            nonStashedReward.unlockedReward != 0;
    }

    function _safeCursorPosition(
        address delegator,
        uint256 toValidatorID,
        uint256 payableEpoch
    ) internal view returns (uint256) {
        uint256 stashedUntil = stashedRewardsUntilEpoch[delegator][toValidatorID];
        if (stashedUntil >= payableEpoch) {
            return payableEpoch;
        }
        // Per-epoch monotonic scan: check every consecutive pair for a rate inversion.
        // The previous two-point check (endpoints of each segment only) missed interior
        // dips where an intermediate epoch had a lower rate than its predecessor but both
        // segment endpoints appeared monotonically increasing. Capped at
        // MAX_CORRUPTION_CHECK_EPOCHS to bound gas; each _stashRewards call advances the
        // cursor by at most that many epochs, processing long ranges incrementally.
        uint256 scanEnd = payableEpoch;
        if (scanEnd > stashedUntil.add(MAX_CORRUPTION_CHECK_EPOCHS)) {
            scanEnd = stashedUntil.add(MAX_CORRUPTION_CHECK_EPOCHS);
        }
        uint256 prevRate = _getEffectiveRewardRate(stashedUntil, toValidatorID);
        for (uint256 epoch = stashedUntil; epoch < scanEnd; epoch++) {
            uint256 nextRate = _getEffectiveRewardRate(epoch.add(1), toValidatorID);
            if (nextRate < prevRate) {
                return epoch;
            }
            prevRate = nextRate;
        }
        return scanEnd;
    }

    function _mintNativeToken(uint256 amount) internal {
        // balance will be increased after the transaction is processed
        node.incBalance(address(this), amount);
        totalSupply = totalSupply.add(amount);
    }

    function _claimRewards(address delegator, uint256 toValidatorID)
        internal
        returns (Rewards memory rewards)
    {
        _stashRewards(delegator, toValidatorID);
        rewards = _rewardsStash[delegator][toValidatorID];
        uint256 totalReward = rewards
            .unlockedReward
            .add(rewards.lockupBaseReward)
            .add(rewards.lockupExtraReward);
        require(totalReward != 0, "zero rewards");
        delete _rewardsStash[delegator][toValidatorID];
        // It's important that we mint after erasing (protection against Re-Entrancy)
        _mintNativeToken(totalReward);
        return rewards;
    }

    function claimRewards(uint256 toValidatorID) external nonReentrant {
        address payable delegator = msg.sender;
        Rewards memory rewards = _claimRewards(delegator, toValidatorID);
        // Gas cap of 50000 covers smart-contract wallets while preventing gas griefing
        (bool sent, ) = delegator.call.value(
            rewards.lockupExtraReward.add(rewards.lockupBaseReward).add(
                rewards.unlockedReward
            )
        ).gas(50000)("");
        require(sent, "Failed to send VC");

        emit ClaimedRewards(
            delegator,
            toValidatorID,
            rewards.lockupExtraReward,
            rewards.lockupBaseReward,
            rewards.unlockedReward
        );
    }

    function restakeRewards(uint256 toValidatorID) external nonReentrant {
        address delegator = msg.sender;

        // Fail fast: if caller is locked up, enforce the minimum remaining
        // duration BEFORE doing any expensive claim/delegate work so a revert
        // doesn't waste gas on paths that will roll back anyway.
        bool wasLockedUp = isLockedUp(delegator, toValidatorID);
        if (wasLockedUp) {
            require(
                getLockupInfo[delegator][toValidatorID].endTime.sub(_now()) >= minLockupDuration(),
                "remaining lockup too short to restake"
            );
        }

        // Snapshot stashed lockup rewards BEFORE _claimRewards calls _stashRewards.
        // _stashRewards may add newly-earned rewards to the stash. Scaling should apply
        // only to the pre-existing stash, not freshly-stashed amounts (which were earned
        // at the old stake rate and should not be inflated by the growth factor).
        uint256 oldStashedBase = getStashedLockupRewards[delegator][toValidatorID].lockupBaseReward;
        uint256 oldStashedExtra = getStashedLockupRewards[delegator][toValidatorID].lockupExtraReward;

        Rewards memory rewards = _claimRewards(delegator, toValidatorID);

        uint256 lockupReward = rewards.lockupExtraReward.add(
            rewards.lockupBaseReward
        );
        _delegate(
            delegator,
            toValidatorID,
            lockupReward.add(rewards.unlockedReward)
        );
        if (wasLockedUp) {
            _restakeExtendLockup(
                delegator,
                toValidatorID,
                lockupReward,
                oldStashedBase,
                oldStashedExtra
            );
        }
        emit RestakedRewards(
            delegator,
            toValidatorID,
            rewards.lockupExtraReward,
            rewards.lockupBaseReward,
            rewards.unlockedReward
        );
    }

    // Extracted from restakeRewards to keep the outer function below solc 0.5.17's
    // 16-slot stack limit. Updates the locked-stake amount and rescales any
    // pre-existing stashed lockup rewards in proportion to the new locked stake,
    // leaving freshly-stashed rewards (added by _claimRewards) unscaled.
    // Caller (restakeRewards) is responsible for enforcing the minimum remaining
    // lockup duration before invoking this helper.
    function _restakeExtendLockup(
        address delegator,
        uint256 toValidatorID,
        uint256 lockupReward,
        uint256 oldStashedBase,
        uint256 oldStashedExtra
    ) private {
        LockedDelegation storage ld = getLockupInfo[delegator][toValidatorID];
        uint256 oldLockedStake = ld.lockedStake;
        uint256 newLockedStake = oldLockedStake.add(lockupReward);
        ld.lockedStake = newLockedStake;
        if (oldLockedStake > 0) {
            Rewards storage stashed = getStashedLockupRewards[delegator][toValidatorID];
            // _stashRewards is additive — after _claimRewards returns, the stash
            // equals oldStashed* + newlyStashed*. Subtract the snapshot to isolate
            // the newly-stashed portion, then scale ONLY the pre-existing portion
            // by newLockedStake/oldLockedStake and add the newly-stashed portion back
            // unchanged (it was earned at the new stake rate and must not be inflated
            // by the growth factor).
            uint256 newlyBase = stashed.lockupBaseReward.sub(oldStashedBase);
            uint256 newlyExtra = stashed.lockupExtraReward.sub(oldStashedExtra);
            stashed.lockupBaseReward = oldStashedBase
                .mul(newLockedStake)
                .div(oldLockedStake)
                .add(newlyBase);
            stashed.lockupExtraReward = oldStashedExtra
                .mul(newLockedStake)
                .div(oldLockedStake)
                .add(newlyExtra);
        }
        uint256 epoch = currentEpoch();
        ld.fromEpoch = epoch;
        emit LockupExtended(delegator, toValidatorID, oldLockedStake, newLockedStake, epoch);
    }

    function _syncValidator(uint256 validatorID, bool syncPubkey) internal {
        require(_validatorExists(validatorID), "validator doesn't exist");
        uint256 weight = getValidator[validatorID].receivedStake;
        if (getValidator[validatorID].status != OK_STATUS) {
            weight = 0;
        }
        node.updateValidatorWeight(validatorID, weight);
        if (syncPubkey && weight != 0) {
            node.updateValidatorPubkey(
                validatorID,
                getValidatorPubkey[validatorID]
            );
        }
    }

    function _validatorExists(uint256 validatorID)
        internal
        view
        returns (bool)
    {
        return getValidator[validatorID].createdTime != 0;
    }

    function offlinePenaltyThreshold()
        external
        view
        returns (uint256 blocksNum, uint256 time)
    {
        return (offlinePenaltyThresholdBlocksNum, offlinePenaltyThresholdTime);
    }

    function queueBaseRewardPerSecond(uint256 value) external onlyOwner {
        require(value > 0, "reward per second must be positive");
        require(
            value <= MAX_BASE_REWARD_PER_SECOND,
            "too large reward per second"
        );
        pendingBaseRewardPerSecond = value;
        pendingBaseRewardPerSecondUnlockTime = _now().add(CORRECTION_TIMELOCK);
        emit BaseRewardPerSecQueued(value, pendingBaseRewardPerSecondUnlockTime);
    }

    function executeBaseRewardPerSecond() external onlyOwner {
        require(pendingBaseRewardPerSecondUnlockTime != 0, "no pending update");
        require(_now() > pendingBaseRewardPerSecondUnlockTime, "timelock not expired");
        require(
            pendingBaseRewardPerSecond <= MAX_BASE_REWARD_PER_SECOND,
            "too large reward per second"
        );
        uint256 oldValue = baseRewardPerSecond;
        baseRewardPerSecond = pendingBaseRewardPerSecond;
        pendingBaseRewardPerSecond = 0;
        pendingBaseRewardPerSecondUnlockTime = 0;
        emit BaseRewardPerSecExecuted(oldValue, baseRewardPerSecond);
    }

    /// @dev No cancel-requeue cooldown is applied because baseRewardPerSecond
    /// is forward-only — future reward accrual changes when executed, but the
    /// pending value does not directly subtract from user claims while queued,
    /// so the substitution hazard does not apply. Cooldown is reserved for
    /// value-substitution flows (slashingRefundRatio, epoch corrections)
    /// where a cancel-and-substitute could harm delegators who planned around
    /// the pending value.
    function cancelBaseRewardPerSecond() external onlyOwner {
        require(pendingBaseRewardPerSecondUnlockTime != 0, "no pending update");
        pendingBaseRewardPerSecond = 0;
        pendingBaseRewardPerSecondUnlockTime = 0;
        emit BaseRewardPerSecCancelled();
    }

    event OfflinePenaltyThresholdQueued(uint256 blocksNum, uint256 time, uint256 unlockTime);
    event OfflinePenaltyThresholdCancelled();

    function queueOfflinePenaltyThreshold(uint256 blocksNum, uint256 time)
        external
        onlyOwner
    {
        require(blocksNum >= MIN_OFFLINE_PENALTY_THRESHOLD_BLOCKS_NUM, "too low penalty blocks num");
        require(time >= MIN_OFFLINE_PENALTY_THRESHOLD_TIME, "too low penalty time");
        pendingOfflinePenaltyBlocksNum = blocksNum;
        pendingOfflinePenaltyTime = time;
        pendingOfflinePenaltyUnlockTime = _now().add(CORRECTION_TIMELOCK);
        emit OfflinePenaltyThresholdQueued(blocksNum, time, pendingOfflinePenaltyUnlockTime);
    }

    function executeOfflinePenaltyThreshold() external onlyOwner {
        require(pendingOfflinePenaltyUnlockTime != 0, "no pending update");
        require(_now() > pendingOfflinePenaltyUnlockTime, "timelock not expired");
        offlinePenaltyThresholdBlocksNum = pendingOfflinePenaltyBlocksNum;
        offlinePenaltyThresholdTime = pendingOfflinePenaltyTime;
        pendingOfflinePenaltyBlocksNum = 0;
        pendingOfflinePenaltyTime = 0;
        pendingOfflinePenaltyUnlockTime = 0;
        emit UpdatedOfflinePenaltyThreshold(offlinePenaltyThresholdBlocksNum, offlinePenaltyThresholdTime);
    }

    /// @dev No cancel-requeue cooldown is applied because the offline penalty
    /// threshold is forward-only — it gates future validator deactivations,
    /// not retrospective claim amounts, so the pending value does not directly
    /// subtract from user claims and the substitution hazard does not apply.
    /// Cooldown is reserved for value-substitution flows (slashingRefundRatio,
    /// epoch corrections) where a cancel-and-substitute could harm delegators
    /// who planned around the pending value.
    function cancelOfflinePenaltyThreshold() external onlyOwner {
        require(pendingOfflinePenaltyUnlockTime != 0, "no pending update");
        pendingOfflinePenaltyBlocksNum = 0;
        pendingOfflinePenaltyTime = 0;
        pendingOfflinePenaltyUnlockTime = 0;
        emit OfflinePenaltyThresholdCancelled();
    }

    // updateSlashingRefundRatio was replaced by queueSlashingRefundRatio / executeSlashingRefundRatio
    // to match the CORRECTION_TIMELOCK governance pattern used by all other owner parameters.

    event SlashingRefundRatioQueued(uint256 indexed validatorID, uint256 refundRatio, uint256 unlockTime);
    event SlashingRefundRatioCancelled(uint256 indexed validatorID);

    function queueSlashingRefundRatio(uint256 validatorID, uint256 refundRatio)
        external
        onlyOwner
    {
        require(
            lastSlashingRefundRatioCancelledAt[validatorID] == 0 ||
            _now() >= lastSlashingRefundRatioCancelledAt[validatorID].add(CORRECTION_TIMELOCK),
            "must wait after cancel"
        );
        PendingSlashingRefund storage existing = pendingSlashingRefundRatios[validatorID];
        if (existing.unlockTime != 0) {
            require(_now() > existing.unlockTime, "slashing refund ratio update pending");
            emit SlashingRefundRatioCancelled(validatorID);
        }
        require(isSlashed(validatorID), "validator isn't slashed");
        require(
            refundRatio <= Decimal.unit(),
            "must be less than or equal to 1.0"
        );
        uint256 unlockTime = _now().add(CORRECTION_TIMELOCK);
        pendingSlashingRefundRatios[validatorID] = PendingSlashingRefund({ratio: refundRatio, unlockTime: unlockTime});
        emit SlashingRefundRatioQueued(validatorID, refundRatio, unlockTime);
    }

    function executeSlashingRefundRatio(uint256 validatorID) external onlyOwner {
        PendingSlashingRefund storage pending = pendingSlashingRefundRatios[validatorID];
        require(pending.unlockTime != 0, "no pending update");
        require(_now() > pending.unlockTime, "timelock not expired");
        uint256 refundRatio = pending.ratio;
        require(isSlashed(validatorID), "validator isn't slashed");
        require(
            refundRatio <= Decimal.unit(),
            "must be less than or equal to 1.0"
        );
        delete pendingSlashingRefundRatios[validatorID];
        slashingRefundRatio[validatorID] = refundRatio;
        emit UpdatedSlashingRefundRatio(validatorID, refundRatio);
    }

    function cancelSlashingRefundRatio(uint256 validatorID) external onlyOwner {
        PendingSlashingRefund storage pending = pendingSlashingRefundRatios[validatorID];
        require(pending.unlockTime != 0, "no pending update");
        delete pendingSlashingRefundRatios[validatorID];
        lastSlashingRefundRatioCancelledAt[validatorID] = _now();
        emit SlashingRefundRatioCancelled(validatorID);
    }

    function queueCorruptedEpochCorrection(
        uint256 epoch,
        uint256 validatorID,
        uint256 correctedAccumulatedRewardPerToken,
        string calldata reason
    ) external onlyOwner {
        require(
            corruptedEpochs[epoch][validatorID],
            "epoch not marked as corrupted"
        );

        require(
            epoch <= currentSealedEpoch,
            "epoch not sealed yet"
        );

        require(epoch > 0, "cannot correct genesis epoch");

        // Serialize adjacent corrections: require epoch-1's pending correction to execute
        // first. Without this, two corrections queued for epochs N and N+1 both measure
        // their delta against an un-executed (lower) baseline, allowing the effective rate
        // to compound by K*maxCorrectionDelta for K consecutive corrupted epochs —
        // exceeding the per-epoch cap by construction.
        if (epoch > 1) {
            require(
                pendingCorrections[epoch.sub(1)][validatorID].unlockTime == 0,
                "execute prior epoch's pending correction first"
            );
        }

        uint256 previousRate = _getEffectiveRewardRate(epoch.sub(1), validatorID);
        require(
            correctedAccumulatedRewardPerToken >= previousRate,
            "corrected rate must be >= previous epoch rate"
        );

        if (epoch < currentSealedEpoch) {
            uint256 nextRate = _getEffectiveRewardRate(epoch.add(1), validatorID);
            if (!corruptedEpochs[epoch.add(1)][validatorID] || isEpochCorrected[epoch.add(1)][validatorID]) {
                require(
                    correctedAccumulatedRewardPerToken <= nextRate,
                    "corrected rate must be <= next epoch rate"
                );
            }
        }

        // Bound delta: prevent owner from setting arbitrarily inflated corrections.
        // Limitation: the cap is measured from previousRate (epoch N-1 effective rate),
        // not from the expected true rate. If the true corrected value lies more than
        // maxCorrectionDelta above previousRate, the owner must raise maxCorrectionDelta
        // via its timelock before queuing the correction.
        require(maxCorrectionDelta > 0, "corrections disabled");
        require(
            correctedAccumulatedRewardPerToken.sub(previousRate) <= maxCorrectionDelta,
            "correction delta exceeds maximum"
        );

        require(
            !isEpochCorrected[epoch][validatorID],
            "epoch already corrected"
        );

        require(bytes(reason).length > 0, "reason cannot be empty");
        require(pendingCorrections[epoch][validatorID].unlockTime == 0, "cancel existing pending correction first");
        // Cancel-requeue cooldown: prevent substituting the queued value after delegators
        // have already planned around it. A CORRECTION_TIMELOCK delay is required between
        // a cancellation and the next queue for the same (epoch, validatorID) pair.
        require(
            correctionCancelTime[epoch][validatorID] == 0 ||
            _now() >= correctionCancelTime[epoch][validatorID].add(CORRECTION_TIMELOCK),
            "must wait CORRECTION_TIMELOCK after cancel before re-queuing"
        );

        uint256 unlockTime = _now().add(CORRECTION_TIMELOCK);
        pendingCorrections[epoch][validatorID] = PendingCorrection({
            correctedAccumulatedRewardPerToken: correctedAccumulatedRewardPerToken,
            reason: reason,
            unlockTime: unlockTime
        });

        emit CorrectionUpdateQueued(
            epoch, validatorID, correctedAccumulatedRewardPerToken, unlockTime, reason
        );
    }

    function queueCorrectionUpdate(
        uint256 epoch,
        uint256 validatorID,
        uint256 correctedAccumulatedRewardPerToken,
        string calldata reason
    ) external onlyOwner {
        require(epoch > 0, "cannot update genesis epoch");
        require(isEpochCorrected[epoch][validatorID], "epoch not yet corrected");
        require(bytes(reason).length > 0, "reason cannot be empty");

        // Serialization: prior epoch's pending correction must execute first so the
        // delta check below uses a stable previousRate (same reason as in
        // queueCorruptedEpochCorrection).
        if (epoch > 1) {
            require(
                pendingCorrections[epoch.sub(1)][validatorID].unlockTime == 0,
                "execute prior epoch's pending correction first"
            );
        }

        uint256 previousRate = _getEffectiveRewardRate(epoch.sub(1), validatorID);
        require(
            correctedAccumulatedRewardPerToken >= previousRate,
            "corrected rate must be >= previous epoch rate"
        );
        if (epoch < currentSealedEpoch) {
            uint256 nextRate = _getEffectiveRewardRate(epoch.add(1), validatorID);
            if (!corruptedEpochs[epoch.add(1)][validatorID] || isEpochCorrected[epoch.add(1)][validatorID]) {
                require(
                    correctedAccumulatedRewardPerToken <= nextRate,
                    "corrected rate must be <= next epoch rate"
                );
            }
        }

        // Bound delta: prevent inflated corrections
        require(maxCorrectionDelta > 0, "corrections disabled");
        require(
            correctedAccumulatedRewardPerToken.sub(previousRate) <= maxCorrectionDelta,
            "correction delta exceeds maximum"
        );

        require(pendingCorrections[epoch][validatorID].unlockTime == 0, "cancel existing pending correction first");
        require(
            correctionCancelTime[epoch][validatorID] == 0 ||
            _now() >= correctionCancelTime[epoch][validatorID].add(CORRECTION_TIMELOCK),
            "must wait CORRECTION_TIMELOCK after cancel before re-queuing"
        );

        uint256 unlockTime = _now().add(CORRECTION_TIMELOCK);
        pendingCorrections[epoch][validatorID] = PendingCorrection({
            correctedAccumulatedRewardPerToken: correctedAccumulatedRewardPerToken,
            reason: reason,
            unlockTime: unlockTime
        });

        emit CorrectionUpdateQueued(
            epoch, validatorID, correctedAccumulatedRewardPerToken, unlockTime, reason
        );
    }

    function executeCorrectionUpdate(
        uint256 epoch,
        uint256 validatorID
    ) external onlyOwner {
        require(epoch > 0, "cannot correct genesis epoch");
        PendingCorrection storage pending = pendingCorrections[epoch][validatorID];
        require(pending.unlockTime != 0, "no pending correction");
        require(_now() > pending.unlockTime, "timelock not expired");

        // Re-validate bounds: adjacent corrections during timelock may have changed rates
        uint256 previousRate = _getEffectiveRewardRate(epoch.sub(1), validatorID);
        require(
            pending.correctedAccumulatedRewardPerToken >= previousRate,
            "stale: violates lower bound"
        );
        if (epoch < currentSealedEpoch) {
            uint256 nextRate = _getEffectiveRewardRate(epoch.add(1), validatorID);
            if (!corruptedEpochs[epoch.add(1)][validatorID] || isEpochCorrected[epoch.add(1)][validatorID]) {
                require(
                    pending.correctedAccumulatedRewardPerToken <= nextRate,
                    "stale: violates upper bound"
                );
            }
        }
        require(maxCorrectionDelta > 0, "corrections disabled");
        require(
            pending.correctedAccumulatedRewardPerToken.sub(previousRate) <= maxCorrectionDelta,
            "stale: correction delta exceeds maximum"
        );

        // Cumulative upward-drift cap. The per-correction cap above only
        // bounds the size of this single revision versus the prior-epoch
        // rate. A sequence of revisions to the SAME (epoch, validatorID) that
        // each respect the per-correction cap could still compound the
        // corrected rate upward well past the intended governance envelope.
        // Enforce a hard cap of CUMULATIVE_CORRECTION_MULTIPLIER *
        // maxCorrectionDelta on the running sum of POSITIVE increments to
        // this corrected rate. Downward revisions are allowed without budget
        // consumption and, importantly, do not reduce the counter — otherwise
        // an attacker with governance control could ping-pong down/up to
        // circumvent the cap.
        uint256 oldCorrected = correctedEpochRewardRate[epoch][validatorID];
        uint256 newCorrected = pending.correctedAccumulatedRewardPerToken;
        if (newCorrected > oldCorrected) {
            uint256 increment = newCorrected.sub(oldCorrected);
            uint256 newTotal = totalCorrectionDelta[epoch][validatorID].add(increment);
            require(
                newTotal <= maxCorrectionDelta.mul(CUMULATIVE_CORRECTION_MULTIPLIER),
                "cumulative correction cap exceeded"
            );
            totalCorrectionDelta[epoch][validatorID] = newTotal;
            emit CumulativeCorrectionDeltaUpdated(epoch, validatorID, increment, newTotal);
        }

        correctedEpochRewardRate[epoch][validatorID] = newCorrected;
        isEpochCorrected[epoch][validatorID] = true;
        correctionReasonHash[epoch][validatorID] = keccak256(bytes(pending.reason));

        emit CorrectionUpdateExecuted(
            epoch, validatorID, pending.correctedAccumulatedRewardPerToken, pending.reason
        );

        delete pendingCorrections[epoch][validatorID];
    }

    function cancelCorrectionUpdate(
        uint256 epoch,
        uint256 validatorID
    ) external onlyOwner {
        require(pendingCorrections[epoch][validatorID].unlockTime != 0, "no pending correction");
        delete pendingCorrections[epoch][validatorID];
        correctionCancelTime[epoch][validatorID] = _now();
        emit CorrectionUpdateCancelled(epoch, validatorID);
    }

    // Removes a corrupted-epoch flag that was set by checkAndLogEpochCorruption.
    // Provides an escape hatch for falsely-flagged epochs (i.e., epochs where the raw
    // rate was lower than the previous epoch due to a transient reporting error but the
    // underlying data is actually valid).
    // LIMITATION: This does NOT unblock delegators for true rate inversions where the
    // raw rate actually decreased. _safeCursorPosition scans rate monotonicity, not the
    // corruptedEpochs flag, so clearing the flag without applying a correction (via
    // executeCorrectionUpdate) will still stop reward stashing at that epoch. This
    // escape hatch is only effective for false-positive flags.
    // Cannot be called once a correction has already been executed for this epoch.
    function uncorruptEpoch(uint256 epoch, uint256 validatorID) external onlyOwner {
        require(corruptedEpochs[epoch][validatorID], "epoch not marked corrupted");
        require(!isEpochCorrected[epoch][validatorID], "epoch already corrected; use queueCorrectionUpdate to revise");
        require(pendingCorrections[epoch][validatorID].unlockTime == 0, "pending correction exists; cancel first");
        corruptedEpochs[epoch][validatorID] = false;
        emit EpochUncorrupted(epoch, validatorID);
    }

    uint256 public constant MAX_CORRECTION_DELTA_CAP = 1e16;

    // Hard-coded multiplier bounding cumulative upward drift of a single
    // (epoch, validatorID)'s corrected rate. The per-correction cap
    // (`maxCorrectionDelta`) prevents any one revision from exceeding its
    // limit, but a sequence of N revisions could otherwise compound to
    // N * maxCorrectionDelta above the original raw rate. At execute time we
    // require the running `totalCorrectionDelta` + new positive increment to
    // stay within `CUMULATIVE_CORRECTION_MULTIPLIER * maxCorrectionDelta`.
    // The multiplier value (3x) is chosen to accommodate one initial
    // correction plus up to two forensic revisions before the governance
    // budget is exhausted; further corrections would require a new
    // `maxCorrectionDelta` execution through the existing timelock pattern.
    uint256 public constant CUMULATIVE_CORRECTION_MULTIPLIER = 3;

    function queueMaxCorrectionDelta(uint256 _maxDelta) external onlyOwner {
        require(_maxDelta > 0, "cannot disable corrections");
        require(_maxDelta <= MAX_CORRECTION_DELTA_CAP, "exceeds maximum correction delta cap");
        pendingMaxCorrectionDelta = _maxDelta;
        pendingMaxCorrectionDeltaUnlockTime = _now().add(CORRECTION_TIMELOCK);
        emit MaxCorrectionDeltaQueued(_maxDelta, pendingMaxCorrectionDeltaUnlockTime);
    }

    function executeMaxCorrectionDelta() external onlyOwner {
        require(pendingMaxCorrectionDeltaUnlockTime != 0, "no pending update");
        require(_now() > pendingMaxCorrectionDeltaUnlockTime, "timelock not expired");
        // Defensive: cancelMaxCorrectionDelta zeroes both fields atomically, so this
        // check is redundant given the unlockTime guard above, but prevents a
        // zero-value execution if the pattern is extended in a future upgrade.
        require(pendingMaxCorrectionDelta > 0, "pending delta is zero");
        uint256 oldValue = maxCorrectionDelta;
        maxCorrectionDelta = pendingMaxCorrectionDelta;
        pendingMaxCorrectionDelta = 0;
        pendingMaxCorrectionDeltaUnlockTime = 0;
        emit MaxCorrectionDeltaUpdated(oldValue, maxCorrectionDelta);
    }

    /// @dev No cancel-requeue cooldown is applied because maxCorrectionDelta
    /// is forward-only — it only bounds the magnitude of future correction
    /// operations, not any already-observed claimable value, so the pending
    /// value does not directly subtract from user claims and the substitution
    /// hazard does not apply. Cooldown is reserved for value-substitution
    /// flows (slashingRefundRatio, epoch corrections) where a
    /// cancel-and-substitute could harm delegators who planned around the
    /// pending value.
    function cancelMaxCorrectionDelta() external onlyOwner {
        require(pendingMaxCorrectionDeltaUnlockTime != 0, "no pending update");
        pendingMaxCorrectionDelta = 0;
        pendingMaxCorrectionDeltaUnlockTime = 0;
        emit MaxCorrectionDeltaCancelled();
    }

    function _sealEpoch_offline(
        EpochSnapshot storage snapshot,
        uint256[] memory validatorIDs,
        uint256[] memory offlineTime,
        uint256[] memory offlineBlocks
    ) internal returns (bool[] memory deactivated) {
        deactivated = new bool[](validatorIDs.length);
        for (uint256 i = 0; i < validatorIDs.length; i++) {
            if (
                offlineBlocks[i] > offlinePenaltyThresholdBlocksNum &&
                offlineTime[i] >= offlinePenaltyThresholdTime
            ) {
                _setValidatorDeactivated(validatorIDs[i], OFFLINE_BIT);
                _syncValidator(validatorIDs[i], false);
                deactivated[i] = true;
            }
            snapshot.offlineTime[validatorIDs[i]] = offlineTime[i];
            snapshot.offlineBlocks[validatorIDs[i]] = offlineBlocks[i];
        }
    }

    function _stashValidatorCommission(
        EpochSnapshot storage snapshot,
        uint256 validatorID,
        uint256 commissionRewardFull
    ) internal {
        if (commissionRewardFull == 0) {
            return;
        }
        // Uses snapshot selfStake (not live) for consistency with receivedStake change above.
        uint256 selfStake = snapshot.selfStake[validatorID];
        if (selfStake == 0) {
            return;
        }
        address validatorAddr = getValidator[validatorID].auth;
        uint256 lCommissionRewardFull = commissionRewardFull
            .mul(snapshot.lockedSelfStake[validatorID])
            .div(selfStake);
        uint256 uCommissionRewardFull = commissionRewardFull.sub(lCommissionRewardFull);
        Rewards memory lCommissionReward = _scaleLockupReward(
            lCommissionRewardFull,
            snapshot.lockedSelfStakeDuration[validatorID]
        );
        Rewards memory uCommissionReward = _scaleLockupReward(
            uCommissionRewardFull,
            0
        );
        _rewardsStash[validatorAddr][validatorID] = sumRewards(
            _rewardsStash[validatorAddr][validatorID],
            lCommissionReward,
            uCommissionReward
        );
        // Only track lockup-specific reward components in getStashedLockupRewards:
        // - Only when validator is actively locked up (snapshot data may reflect a lockup
        //   that expired mid-epoch; unconditional writes inflate future early-exit penalty).
        // - Only lCommissionReward's lockup fields: uCommissionReward.lockupBaseReward and
        //   uCommissionReward.lockupExtraReward are both zero (_scaleLockupReward(..., 0)
        //   sets only unlockedReward). Using sumRewards would also add uCommissionReward's
        //   unlockedReward into getStashedLockupRewards, polluting it with a field that
        //   _popDelegationUnlockPenalty never reads but that restakeRewards would scale.
        if (isLockedUp(validatorAddr, validatorID)) {
            getStashedLockupRewards[validatorAddr][validatorID].lockupExtraReward =
                getStashedLockupRewards[validatorAddr][validatorID].lockupExtraReward
                .add(lCommissionReward.lockupExtraReward);
            getStashedLockupRewards[validatorAddr][validatorID].lockupBaseReward =
                getStashedLockupRewards[validatorAddr][validatorID].lockupBaseReward
                .add(lCommissionReward.lockupBaseReward);
        }
    }

    struct _SealEpochRewardsCtx {
        uint256[] baseRewardWeights;
        uint256 totalBaseRewardWeight;
        uint256[] txRewardWeights;
        uint256 totalTxRewardWeight;
        uint256 epochDuration;
        uint256 epochFee;
    }

    function _sealEpoch_rewards(
        EpochSnapshot storage snapshot,
        uint256[] memory validatorIDs,
        uint256[] memory uptimes,
        uint256[] memory accumulatedOriginatedTxsFee,
        bool[] memory deactivated
    ) internal {
        _SealEpochRewardsCtx memory ctx = _SealEpochRewardsCtx(
            new uint256[](validatorIDs.length),
            0,
            new uint256[](validatorIDs.length),
            0,
            0,
            0
        );
        EpochSnapshot storage prevSnapshot = getEpochSnapshot[
            currentSealedEpoch
        ];

        ctx.epochDuration = 1;
        if (_now() > prevSnapshot.endTime) {
            ctx.epochDuration = _now().sub(prevSnapshot.endTime);
        }

        for (uint256 i = 0; i < validatorIDs.length; i++) {
            if (deactivated[i]) {
                continue;
            }
            uint256 prevAccumulatedTxsFee = prevSnapshot
                .accumulatedOriginatedTxsFee[validatorIDs[i]];
            uint256 originatedTxsFee = 0;
            if (accumulatedOriginatedTxsFee[i] > prevAccumulatedTxsFee) {
                originatedTxsFee = accumulatedOriginatedTxsFee[i].sub(
                    prevAccumulatedTxsFee
                );
            }
            // Cap uptime to epochDuration: an uptime exceeding the epoch length would
            // inflate the tx reward weight beyond 100%, over-rewarding the validator.
            uint256 uptimeCapped = uptimes[i] > ctx.epochDuration ? ctx.epochDuration : uptimes[i];
            ctx.txRewardWeights[i] = originatedTxsFee.mul(uptimeCapped).div(ctx.epochDuration);
            ctx.totalTxRewardWeight = ctx.totalTxRewardWeight.add(
                ctx.txRewardWeights[i]
            );
            ctx.epochFee = ctx.epochFee.add(originatedTxsFee);
        }

        for (uint256 i = 0; i < validatorIDs.length; i++) {
            if (deactivated[i]) {
                continue;
            }
            uint256 uptimeCapped = uptimes[i] > ctx.epochDuration ? ctx.epochDuration : uptimes[i];
            uint256 stakeTimeUptime = snapshot.receivedStake[validatorIDs[i]].mul(uptimeCapped).div(ctx.epochDuration);
            ctx.baseRewardWeights[i] = stakeTimeUptime.mul(uptimeCapped).div(ctx.epochDuration);
            ctx.totalBaseRewardWeight = ctx.totalBaseRewardWeight.add(
                ctx.baseRewardWeights[i]
            );
        }

        for (uint256 i = 0; i < validatorIDs.length; i++) {
            uint256 validatorID = validatorIDs[i];

            if (deactivated[i]) {
                snapshot.accumulatedRewardPerToken[validatorID] =
                    prevSnapshot.accumulatedRewardPerToken[validatorID];
                snapshot.accumulatedOriginatedTxsFee[validatorID] = accumulatedOriginatedTxsFee[i];
                uint256 uptimeCappedD = uptimes[i] > ctx.epochDuration ? ctx.epochDuration : uptimes[i];
                snapshot.accumulatedUptime[validatorID] =
                    prevSnapshot.accumulatedUptime[validatorID].add(uptimeCappedD);
                continue;
            }

            uint256 rawReward = _calcRawValidatorEpochBaseReward(
                ctx.epochDuration,
                baseRewardPerSecond,
                ctx.baseRewardWeights[i],
                ctx.totalBaseRewardWeight
            );
            rawReward = rawReward.add(
                _calcRawValidatorEpochTxReward(
                    ctx.epochFee,
                    ctx.txRewardWeights[i],
                    ctx.totalTxRewardWeight
                )
            );

            uint256 commissionRewardFull = _calcValidatorCommission(
                rawReward,
                validatorCommission()
            );
            _stashValidatorCommission(snapshot, validatorID, commissionRewardFull);
            uint256 delegatorsReward = rawReward.sub(commissionRewardFull);
            // Uses snapshot stake (not live) for consistency — prevents manipulation between
            // sealEpochValidators and sealEpoch. Behavioral change from original (which used live state).
            uint256 receivedStake = snapshot.receivedStake[validatorID];
            uint256 rewardPerToken = 0;
            if (receivedStake != 0) {
                rewardPerToken = delegatorsReward.mul(Decimal.unit()).div(receivedStake);
            }
            // If this validator is re-entering after a healed offline gap, prevSnapshot (a gap
            // epoch) holds 0; _healedReseedBase builds from the carried pre-gap rate R instead so
            // the monotonic index never dips. Extracted to a helper to keep this loop body within
            // the EVM 16-local stack limit (solc 0.5.17). Works for any re-entry epoch, absorbing
            // the Opera two-phase validator-set activation lag.
            snapshot.accumulatedRewardPerToken[validatorID] =
                _healedReseedBase(validatorID, prevSnapshot.accumulatedRewardPerToken[validatorID])
                    .add(rewardPerToken);
            // The accumulatedOriginatedTxsFee / accumulatedUptime writes below are intentionally
            // unchanged by the reactivation heal: they do not feed _newRewardsOf, and the tx-fee
            // delta at re-entry is computed against prevSnapshot's fee (0 for a gap epoch) with
            // the node re-add semantics verified separately.
            snapshot.accumulatedOriginatedTxsFee[
                validatorID
            ] = accumulatedOriginatedTxsFee[i];
            uint256 uptimeCappedA = uptimes[i] > ctx.epochDuration ? ctx.epochDuration : uptimes[i];
            snapshot.accumulatedUptime[validatorID] =
                prevSnapshot.accumulatedUptime[validatorID].add(uptimeCappedA);
        }

        snapshot.epochFee = ctx.epochFee;
        snapshot.totalBaseRewardWeight = ctx.totalBaseRewardWeight;
        snapshot.totalTxRewardWeight = ctx.totalTxRewardWeight;
    }

    function sealEpoch(
        uint256[] calldata offlineTime,
        uint256[] calldata offlineBlocks,
        uint256[] calldata uptimes,
        uint256[] calldata originatedTxsFee
    ) external onlyDriver {
        EpochSnapshot storage snapshot = getEpochSnapshot[currentEpoch()];
        uint256[] memory validatorIDs = snapshot.validatorIDs;

        // Ensure sealEpochValidators was called first
        require(validatorIDs.length > 0, "validators not sealed yet");

        require(offlineTime.length == validatorIDs.length, "offlineTime length mismatch");
        require(offlineBlocks.length == validatorIDs.length, "offlineBlocks length mismatch");
        require(uptimes.length == validatorIDs.length, "uptimes length mismatch");
        require(originatedTxsFee.length == validatorIDs.length, "originatedTxsFee length mismatch");

        bool[] memory deactivated = _sealEpoch_offline(snapshot, validatorIDs, offlineTime, offlineBlocks);
        _sealEpoch_rewards(snapshot, validatorIDs, uptimes, originatedTxsFee, deactivated);

        currentSealedEpoch = currentEpoch();
        snapshot.endTime = _now();
        snapshot.baseRewardPerSecond = baseRewardPerSecond;
        snapshot.totalSupply = totalSupply;

        // Capture receivedStake at epoch-close for all active validators.
        // sealEpochValidators reads from this to prevent delegate/undelegate
        // manipulation of the reward snapshot between epoch boundaries.
        for (uint256 i = 0; i < validatorIDs.length; i++) {
            _epochEndReceivedStake[currentSealedEpoch][validatorIDs[i]] = getValidator[validatorIDs[i]].receivedStake;
        }
        emit EpochSealed(currentSealedEpoch, snapshot.endTime, snapshot.baseRewardPerSecond, snapshot.totalSupply);
    }

    uint256 public constant MAX_VALIDATORS = 200;

    function sealEpochValidators(uint256[] calldata nextValidatorIDs)
        external
        onlyDriver
    {
        require(nextValidatorIDs.length <= MAX_VALIDATORS, "too many validators");
        EpochSnapshot storage snapshot = getEpochSnapshot[currentEpoch()];
        require(snapshot.validatorIDs.length == 0, "validators already sealed for this epoch");
        for (uint256 i = 0; i < nextValidatorIDs.length; i++) {
            uint256 validatorID = nextValidatorIDs[i];
            require(_validatorExists(validatorID), "validator doesn't exist");
            require(getValidator[validatorID].status == OK_STATUS, "validator isn't active");
            require(snapshot.receivedStake[validatorID] == 0, "duplicate validator ID");
            // Use epoch-close stake snapshot when available (prevents delegate/undelegate
            // manipulation between epoch boundaries). Fall back to live state for new validators.
            uint256 receivedStake = _epochEndReceivedStake[currentSealedEpoch][validatorID];
            if (receivedStake == 0) {
                receivedStake = getValidator[validatorID].receivedStake;
            }
            require(receivedStake > 0, "validator has no stake");
            snapshot.receivedStake[validatorID] = receivedStake;
            snapshot.totalStake = snapshot.totalStake.add(receivedStake);
            address validatorAddr = getValidator[validatorID].auth;
            snapshot.selfStake[validatorID] = getStake[validatorAddr][validatorID];
            snapshot.lockedSelfStake[validatorID] = getLockedStake(validatorAddr, validatorID);
            snapshot.lockedSelfStakeDuration[validatorID] = getLockupInfo[validatorAddr][validatorID].duration;
        }
        snapshot.validatorIDs = nextValidatorIDs;
    }

    function _now() internal view returns (uint256) {
        return block.timestamp;
    }

    function epochEndTime(uint256 epoch) internal view returns (uint256) {
        return getEpochSnapshot[epoch].endTime;
    }

    function isLockedUp(address delegator, uint256 toValidatorID)
        public
        view
        returns (bool)
    {
        return
            getLockupInfo[delegator][toValidatorID].endTime != 0 &&
            getLockupInfo[delegator][toValidatorID].lockedStake != 0 &&
            _now() <= getLockupInfo[delegator][toValidatorID].endTime;
    }

    function _isLockedUpAtEpoch(
        address delegator,
        uint256 toValidatorID,
        uint256 epoch
    ) internal view returns (bool) {
        return
            getLockupInfo[delegator][toValidatorID].fromEpoch <= epoch &&
            epochEndTime(epoch) <=
            getLockupInfo[delegator][toValidatorID].endTime;
    }

    function getUnlockedStake(address delegator, uint256 toValidatorID)
        public
        view
        returns (uint256)
    {
        if (!isLockedUp(delegator, toValidatorID)) {
            return getStake[delegator][toValidatorID];
        }
        // Cap lockedStake to actual stake to prevent underflow revert after partial slashing
        uint256 stake = getStake[delegator][toValidatorID];
        uint256 locked = getLockupInfo[delegator][toValidatorID].lockedStake;
        if (locked > stake) {
            return 0;
        }
        return stake.sub(locked);
    }

    function _lockStake(
        address delegator,
        uint256 toValidatorID,
        uint256 lockupDuration,
        uint256 amount
    ) internal {
        require(_validatorExists(toValidatorID), "validator doesn't exist");
        require(
            amount <= getUnlockedStake(delegator, toValidatorID),
            "not enough stake"
        );
        require(
            getValidator[toValidatorID].status == OK_STATUS,
            "validator isn't active"
        );

        require(
            lockupDuration >= minLockupDuration() &&
                lockupDuration <= maxLockupDuration(),
            "incorrect duration"
        );
        uint256 endTime = _now().add(lockupDuration);
        address validatorAddr = getValidator[toValidatorID].auth;
        if (delegator != validatorAddr) {
            // Use isLockedUp for a clear error when the validator has no active lockup,
            // rather than silently computing validatorRemainingTime = 0 and reverting with
            // a misleading "duration exceeds remaining time" message.
            require(
                isLockedUp(validatorAddr, toValidatorID),
                "validator is not locked up"
            );
            // Delegator lockup duration must not exceed the validator's remaining lockup time.
            uint256 validatorRemainingTime = getLockupInfo[validatorAddr][toValidatorID].endTime.sub(_now());
            require(
                lockupDuration <= validatorRemainingTime,
                "lockup duration exceeds validator's remaining lockup time"
            );
        }

        _stashRewards(delegator, toValidatorID);

        // Compare the new absolute end-time against the existing end-time,
        // NOT the new duration against the old duration. Elapsed time must
        // count: a 340-day lock with 40 days remaining may be relocked for
        // 50 days, because the new end-time is still later than the current
        // one. Comparing durations would wrongly reject that relock.
        //
        // After _stashRewards, expired lockups are deleted, so `ld.endTime`
        // is 0 for first-time locks and just-expired relocks — the check
        // passes trivially in those cases. The `lockupDuration <=
        // maxLockupDuration()` require above still caps the new lock.
        LockedDelegation storage ld = getLockupInfo[delegator][toValidatorID];
        require(
            endTime >= ld.endTime,
            "lock end-time cannot decrease"
        );

        ld.lockedStake = ld.lockedStake.add(amount);
        ld.fromEpoch = currentEpoch();
        ld.endTime = endTime;
        ld.duration = lockupDuration;

        emit LockedUpStake(delegator, toValidatorID, lockupDuration, amount);
    }

    function lockStake(
        uint256 toValidatorID,
        uint256 lockupDuration,
        uint256 amount
    ) external nonReentrant {
        address delegator = msg.sender;
        require(amount > 0, "zero amount");
        require(!isLockedUp(delegator, toValidatorID), "already locked up");
        _lockStake(delegator, toValidatorID, lockupDuration, amount);
    }

    function relockStake(
        uint256 toValidatorID,
        uint256 lockupDuration,
        uint256 amount
    ) external nonReentrant {
        address delegator = msg.sender;
        require(amount > 0, "zero amount");
        _lockStake(delegator, toValidatorID, lockupDuration, amount);
    }

    // Computes the early-unlock penalty for `unlockAmount` out of `totalAmount`
    // locked stake, and consumes the proportional slice of the two lockup-reward
    // components that constitute the penalty basis.
    //
    // Invariant preserved at the cap boundary:
    //   (lockupExtraRewardShare consumed) + (lockupBaseRewardShare consumed) / 2
    //     == returned `penalty`
    //
    // When `originalPenalty` exceeds `unlockAmount`, the penalty is clamped to
    // `unlockAmount` (`cappedPenalty`) to avoid penalizing the delegator more
    // than they are unlocking. Both reward-share deductions are rescaled by
    // the ratio `cappedPenalty / originalPenalty` so the invariant above still
    // holds post-clamp and stashed rewards are NOT over-deducted.
    //
    // Note: only `getStashedLockupRewards.lockupExtraReward` and
    // `getStashedLockupRewards.lockupBaseReward` feed into the penalty basis;
    // `_rewardsStash[delegator][toValidatorID].unlockedReward` is claimable
    // reward value (not a penalty component) and is intentionally NOT deducted
    // here — claimants still collect it via the normal reward-claim path.
    function _popDelegationUnlockPenalty(
        address delegator,
        uint256 toValidatorID,
        uint256 unlockAmount,
        uint256 totalAmount
    ) internal returns (uint256) {
        require(totalAmount > 0, "zero total locked amount");
        uint256 lockupExtraRewardShare = getStashedLockupRewards[delegator][
            toValidatorID
        ].lockupExtraReward.mul(unlockAmount).div(totalAmount);
        uint256 lockupBaseRewardShare = getStashedLockupRewards[delegator][
            toValidatorID
        ].lockupBaseReward.mul(unlockAmount).div(totalAmount);
        uint256 originalPenalty = lockupExtraRewardShare.add(lockupBaseRewardShare.div(2));
        uint256 cappedPenalty = originalPenalty;
        if (originalPenalty >= unlockAmount) {
            // Penalty is clamped to unlockAmount. Rescale both reward-share
            // deductions by cappedPenalty / originalPenalty (algebraically
            // equivalent to unlockAmount / originalPenalty at this branch) so
            // the stashed-reward deductions remain proportional to the actual
            // penalty applied. originalPenalty > 0 is guaranteed here because
            // originalPenalty >= unlockAmount > 0 follows from the branch
            // condition plus the unlockStake require that `amount > 0`.
            cappedPenalty = unlockAmount;
            if (originalPenalty > 0) {
                lockupExtraRewardShare = lockupExtraRewardShare.mul(cappedPenalty).div(originalPenalty);
                lockupBaseRewardShare = lockupBaseRewardShare.mul(cappedPenalty).div(originalPenalty);
            }
        }
        getStashedLockupRewards[delegator][toValidatorID]
            .lockupExtraReward = getStashedLockupRewards[delegator][
            toValidatorID
        ].lockupExtraReward.sub(lockupExtraRewardShare);
        getStashedLockupRewards[delegator][toValidatorID]
            .lockupBaseReward = getStashedLockupRewards[delegator][
            toValidatorID
        ].lockupBaseReward.sub(lockupBaseRewardShare);
        return cappedPenalty;
    }

    function unlockStake(uint256 toValidatorID, uint256 amount)
        external
        nonReentrant
        returns (uint256)
    {
        address delegator = msg.sender;
        LockedDelegation storage ld = getLockupInfo[delegator][toValidatorID];

        require(amount > 0, "zero amount");
        require(isLockedUp(delegator, toValidatorID), "not locked up");
        require(amount <= ld.lockedStake, "not enough locked stake");

        _stashRewards(delegator, toValidatorID);

        // Mirror the corruption guard from undelegate: if rewards are blocked by a
        // corrupted epoch, unlocking would delete getLockupInfo and getStashedLockupRewards
        // (when lockedStake reaches zero), permanently destroying the penalty basis and
        // making any stash beyond the corruption cursor unrecoverable.
        {
            uint256 payableEpoch = _highestPayableEpoch(toValidatorID);
            uint256 safeCursor = _safeCursorPosition(delegator, toValidatorID, payableEpoch);
            require(safeCursor >= payableEpoch, "claim rewards blocked by corruption; wait for epoch correction");
        }

        // _popDelegationUnlockPenalty must be called before reducing ld.lockedStake.
        // It uses ld.lockedStake as the totalAmount denominator for proportional slashing;
        // reducing it first would inflate the per-unit penalty on partial unlocks.
        uint256 penalty = _popDelegationUnlockPenalty(
            delegator,
            toValidatorID,
            amount,
            ld.lockedStake
        );

        ld.lockedStake = ld.lockedStake.sub(amount);
        if (penalty != 0) {
            totalPenalty = totalPenalty.add(penalty);
            _rawUndelegate(delegator, toValidatorID, penalty);
            // Clamp lockedStake: penalty via _rawUndelegate can push lockedStake > stake, trapping funds.
            // Scale stashed lockup rewards proportionally so the rewards-to-stake ratio is preserved.
            uint256 currentStake = getStake[delegator][toValidatorID];
            if (ld.lockedStake > currentStake) {
                Rewards storage stashedForClamp = getStashedLockupRewards[delegator][toValidatorID];
                stashedForClamp.lockupBaseReward = stashedForClamp.lockupBaseReward.mul(currentStake).div(ld.lockedStake);
                stashedForClamp.lockupExtraReward = stashedForClamp.lockupExtraReward.mul(currentStake).div(ld.lockedStake);
                ld.lockedStake = currentStake;
            }
            emit PenaltyApplied(delegator, toValidatorID, penalty);
            emit PenaltyUndelegated(delegator, toValidatorID, penalty);
        }

        if (ld.lockedStake == 0) {
            delete getLockupInfo[delegator][toValidatorID];
            delete getStashedLockupRewards[delegator][toValidatorID];
        }

        _syncValidator(toValidatorID, false);

        emit UnlockedStake(delegator, toValidatorID, amount, penalty);
        return penalty;
    }

    function reactivateValidator(uint256 validatorID) external nonReentrant {
        require(_validatorExists(validatorID), "validator doesn't exist");

        // Owner retains full (looser) power; any other caller must be the validator's own
        // (immutable, non-rotatable) auth key, may reactivate ONLY from a pure-OFFLINE status,
        // and only after an anti-flap cooldown. Doublesign/withdrawn/unknown bits fail closed.
        bool byOwner = isOwner();
        if (!byOwner) {
            require(msg.sender == getValidator[validatorID].auth, "not authorized to reactivate");
            require(
                (getValidator[validatorID].status & ~OFFLINE_BIT) == 0,
                "self-reactivation allowed only from offline status"
            );
            require(
                _now() >= getValidator[validatorID].deactivatedTime.add(offlinePenaltyThresholdTime),
                "reactivation cooldown not elapsed"
            );
        }

        require(getValidator[validatorID].status != OK_STATUS, "already active");
        require(getValidator[validatorID].deactivatedEpoch != 0, "validator was never activated");
        require(
            (getValidator[validatorID].status & CHEATER_MASK) == 0,
            "cheaters cannot be reactivated"
        );
        require(getSelfStake(validatorID) >= minSelfStake(), "insufficient self-stake");
        require(_checkDelegatedStakeLimit(validatorID), "validator's delegations limit is exceeded");

        // Capture the pre-gap reward rate R (flat-carried at the deactivation epoch, see
        // _sealEpoch_rewards deactivated-branch) BEFORE clearing deactivatedEpoch, so the reward
        // index can be healed across the offline gap. R==0 => no rewards accrued pre-gap => no
        // inversion => heal records stay 0 and the read-through is inert.
        uint256 deactEpoch = getValidator[validatorID].deactivatedEpoch;
        reactivationHealFloor[validatorID] = getEpochSnapshot[deactEpoch].accumulatedRewardPerToken[validatorID];
        reactivationHealFrom[validatorID] = deactEpoch.add(1);

        totalActiveStake = totalActiveStake.add(getValidator[validatorID].receivedStake);
        getValidator[validatorID].status = OK_STATUS;
        // Clear deactivated state so _highestPayableEpoch returns currentSealedEpoch again,
        // allowing delegators to claim rewards up to the current epoch going forward.
        getValidator[validatorID].deactivatedEpoch = 0;
        getValidator[validatorID].deactivatedTime = 0;

        _syncValidator(validatorID, true);
        emit ReactivatedValidator(validatorID);
    }

    function rewardsBlockedByCorruption(
        address delegator,
        uint256 toValidatorID
    ) external view returns (bool blocked, uint256 blockedAtEpoch) {
        uint256 payableEpoch = _highestPayableEpoch(toValidatorID);
        uint256 safeCursor = _safeCursorPosition(delegator, toValidatorID, payableEpoch);
        if (safeCursor < payableEpoch) {
            return (true, safeCursor);
        }
        return (false, 0);
    }

    // New variables added for proxy-safe upgrade (consume gap slots, placed at end of storage)
    // Track all genesis validators (replaces the single-address _legacyGenesisValidator for new lookups)
    mapping(address => bool) public isGenesisValidator;
    // Inline reentrancy guard (not inherited, to preserve proxy storage layout).
    // States: 0 = never-written (pre-patch default), 1 = initialized/not entered, 2 = entered.
    // Both 0 and 1 are accepted as "not entered" so the guard works on contracts that
    // were genesis-deployed before this slot existed and later received the bytecode
    // via the evmwriter precompile (SfcV2Patch / SfcV2Patch2) — `initialize()` is
    // `initializer`-gated and cannot re-run to populate the slot post-patch.
    // UPGRADE RISK: if a future upgrade inherits OZ ReentrancyGuard, it inserts its
    // own storage slot at the inherited contract's position in the layout, conflicting
    // with this variable. Always keep the guard inline and document its slot position
    // in any upgrade diff to prevent silent storage corruption.
    // Captures receivedStake at epoch-close for each active validator.
    // Used by sealEpochValidators to read stake anchored at epoch-start,
    // preventing delegate/undelegate timing manipulation of reward snapshots.
    mapping(uint256 => mapping(uint256 => uint256)) private _epochEndReceivedStake;

    uint256 private _reentrancyGuardCounter;

    modifier nonReentrant() {
        // Counter must be strictly below 2. Legitimate non-entered values are 0 (never
        // written — this slot didn't exist at genesis; initialize() already consumed
        // its `initializer` gate and cannot re-run after an evmwriter bytecode patch)
        // and 1 (explicitly initialized). 2 means "actively entered"; any value above 2
        // can only come from storage corruption (e.g. a future upgrade inheriting OZ
        // ReentrancyGuard and colliding with this slot — see UPGRADE RISK above) and
        // must fail closed. The post-body write normalises 0 → 1, so after the first
        // successful guarded call every subsequent call sees the standard 1/2 pattern.
        require(_reentrancyGuardCounter < 2, "ReentrancyGuard: reentrant call");
        _reentrancyGuardCounter = 2;
        _;
        _reentrancyGuardCounter = 1;
    }

    // --- Self-service reactivation reward-gap healing (proxy-safe: appended before __gap) ---
    // When a validator is reactivated after an OFFLINE gap, its per-epoch
    // accumulatedRewardPerToken is absent (default 0) for every gap epoch, inverting the
    // monotonic reward index and freezing delegators (see _safeCursorPosition). These records
    // let _getEffectiveRewardRate carry the pre-gap rate R forward across the gap window, and
    // let _sealEpoch_rewards reseed the re-entry epoch from R — so no inversion is ever created
    // and no owner correction is needed. Scoped strictly to epoch >= reactivationHealFrom with a
    // set floor, so a genuine inversion outside a reactivation gap is never masked. Records are
    // NOT cleared (a delegator may claim across the gap arbitrarily far in the future).
    //
    // KNOWN EDGE CASE (documented, non-blocking): a repeated deactivate->reactivate before a
    // delegator stashes overwrites this single {floor,from} pair with the 2nd reactivation's
    // (higher R2, later from), so a 1st-gap delegator could be re-stranded on gap1. A delegator
    // who claims/delegates/undelegates (all of which stash) between the two gaps is unaffected; a
    // FULLY PASSIVE delegator who does none of those relies on the backstop — the retained
    // owner-correction pipeline and the sfc_patch8 Go backfill — NOT on the anti-flap cooldown
    // alone (the cooldown only widens the window in which a stash can land; it does not itself heal).
    mapping(uint256 => uint256) public reactivationHealFloor; // validatorID => pre-gap flat rate R (0 = none)
    mapping(uint256 => uint256) public reactivationHealFrom;  // validatorID => first gap epoch (deactivatedEpoch+1)

    // Reserve storage slots for future upgrades without breaking storage layout
    // New gap (original SFC had no gap). Reserves space for future proxy-safe upgrades.
    // 46 slots available after isGenesisValidator (1) + _reentrancyGuardCounter (1)
    // + reactivationHealFloor (1) + reactivationHealFrom (1).
    uint256[46] private __gap;
}