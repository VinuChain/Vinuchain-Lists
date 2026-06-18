pragma experimental ABIEncoderV2;
pragma solidity 0.5.17;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../common/Initializable.sol";
import "../ownership/Ownable.sol";
import "./SFC.sol";

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
        require(newDriverAuth != address(0), "invalid newDriverAuth address");
        require(isContract(newDriverAuth), "newDriverAuth must be a contract");
        pendingMigration = newDriverAuth;
        pendingMigrationUnlockTime = block.timestamp.add(ADMIN_TIMELOCK);
        emit MigrationQueued(newDriverAuth, pendingMigrationUnlockTime);
    }

    function executeMigration() external onlyOwner {
        require(pendingMigrationUnlockTime != 0, "no pending migration");
        require(block.timestamp >= pendingMigrationUnlockTime, "timelock not expired");
        address target = pendingMigration;
        require(isContract(target), "target no longer a contract");
        pendingMigration = address(0);
        pendingMigrationUnlockTime = 0;
        driver.setBackend(target);
        emit MigrationExecuted(target);
    }

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
        require(isContract(acc) && isContract(from), "not a contract");
        pendingCopyCodeTarget = acc;
        pendingCopyCodeSource = from;
        pendingCopyCodeUnlockTime = block.timestamp.add(ADMIN_TIMELOCK);
        emit CopyCodeQueued(acc, from, pendingCopyCodeUnlockTime);
    }

    function executeCopyCode() external onlyOwner {
        require(pendingCopyCodeUnlockTime != 0, "no pending copyCode");
        require(block.timestamp >= pendingCopyCodeUnlockTime, "timelock not expired");
        address acc = pendingCopyCodeTarget;
        address from = pendingCopyCodeSource;
        require(isContract(acc) && isContract(from), "target or source no longer a contract");
        pendingCopyCodeTarget = address(0);
        pendingCopyCodeSource = address(0);
        pendingCopyCodeUnlockTime = 0;
        driver.copyCode(acc, from);
        emit CopyCodeExecuted(acc, from);
    }

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
