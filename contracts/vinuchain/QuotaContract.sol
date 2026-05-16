// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';

/**
 * @title Quota Contract
 * @dev This contract manages staking, delegations, and withdrawals.
 */
contract QuotaContract is Initializable, OwnableUpgradeable {
    using EnumerableSet for EnumerableSet.UintSet;

    struct WithdrawalRequest {
        uint256 id;
        uint256 time;
        uint256 amount;
        uint256 unlockTime;
        bool completed;
    }

    uint256 public constant MIN_HOLD_TIME = 1;
    uint256 public constant MAX_HOLD_TIME = 10**9;
    uint256 public constant MIN_QUOTA_FACTOR = 10**3;
    uint256 public constant MAX_QUOTA_FACTOR = 10**18;
    uint256 public constant MIN_MIN_STAKE = 1;
    uint256 public constant MAX_MIN_STAKE = 10**30;
    uint256 public constant MIN_FEE_REFUND_BLOCK_COUNT = 1;
    uint256 public constant MAX_FEE_REFUND_BLOCK_COUNT = 1000;

    uint256 public totalStake;
    uint256 public minStake;
    uint256 public holdTime;
    uint256 public quotaFactor;
    uint256 public withdrawalRequestIdCounter;
    uint16 public feeRefundBlockCount;

    mapping(address => uint256) public getStake;
    mapping(address => mapping(uint256 => WithdrawalRequest))
        public getWithdrawalRequest;
    mapping(address => EnumerableSet.UintSet)
        private _activeWithdrawalRequestIDs;
    mapping(address => uint256[]) public completedWithdrawalRequestIDs;
    // Appended after the original V1 storage slots so proxy upgrades do not
    // shift existing withdrawal request or active-request mappings.
    mapping(address => mapping(address => uint256)) public getFundedStake;
    mapping(address => mapping(uint256 => address))
        public getWithdrawalRequestDelegator;
    mapping(address => uint256) public getExternallyFundedStake;

    event FeeRefundBlockCountUpdated(uint16 indexed newFeeRefundBlockCount);
    event MinStakeUpdated(uint256 indexed newMinStake);
    event HoldTimeUpdated(uint256 indexed newHoldTime);
    event QuotaFactorUpdated(uint256 indexed newQuotaFactor);
    event Delegate(address indexed delegator, uint256 amount);
    event StakeFor(
        address indexed staker,
        address indexed delegator,
        uint256 amount
    );
    event Undelegated(
        address indexed delegator,
        uint256 amount,
        uint256 indexed wrID
    );
    event UndelegatedFor(
        address indexed staker,
        address indexed delegator,
        uint256 amount,
        uint256 indexed wrID
    );
    event Withdrawn(
        address indexed delegator,
        uint256 amount,
        uint256 indexed wrID
    );
    event WithdrawnFor(
        address indexed staker,
        address indexed delegator,
        uint256 amount,
        uint256 indexed wrID
    );

    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the QuotaContract with essential parameters and sets the initial ownership.
     * @param owner The address that will be assigned as the owner of the contract.
     * @param _feeRefundBlockCount The initial number of blocks for the fee refund period.
     * @param _minStake The minimum amount of ETH (in wei) required to participate in staking.
     * @param _quotaFactor A factor used in the quota calculations, affecting withdrawal limits.
     * @param _holdTime The lock-up period (in seconds) that staked funds must be held for before withdrawal.
     *
     */
    function initialize(
        address owner,
        uint16 _feeRefundBlockCount,
        uint256 _minStake,
        uint256 _quotaFactor,
        uint256 _holdTime
    ) external initializer {
        require(owner != address(0), 'Owner: zero address');
        require(
            _feeRefundBlockCount >= MIN_FEE_REFUND_BLOCK_COUNT,
            'feeRefundBlockCount < 1'
        );
        require(
            _feeRefundBlockCount <= MAX_FEE_REFUND_BLOCK_COUNT,
            'feeRefundBlockCount > 1000'
        );
        require(_minStake >= MIN_MIN_STAKE, 'MinStake must be at least 1');
        require(_minStake <= MAX_MIN_STAKE, 'MinStake must be at most 10^30');
        require(_quotaFactor >= MIN_QUOTA_FACTOR, 'QuotaFactor < 10^3');
        require(_quotaFactor <= MAX_QUOTA_FACTOR, 'QuotaFactor > 10^18');
        require(_holdTime >= MIN_HOLD_TIME, 'HoldTime must be at least 1');
        require(_holdTime <= MAX_HOLD_TIME, 'HoldTime must be at most 10^9');

        _transferOwnership(owner);

        feeRefundBlockCount = _feeRefundBlockCount;
        minStake = _minStake;
        quotaFactor = _quotaFactor;
        holdTime = _holdTime;
    }

    /**
     * @dev Sets the fee refund block count.
     * @param feeRefundBlockCount_ The new fee refund block count.
     */
    function setFeeRefundBlockCount(uint16 feeRefundBlockCount_)
        external
        onlyOwner
    {
        require(
            feeRefundBlockCount_ >= MIN_FEE_REFUND_BLOCK_COUNT,
            'feeRefundBlockCount < 1'
        );
        require(
            feeRefundBlockCount_ <= MAX_FEE_REFUND_BLOCK_COUNT,
            'feeRefundBlockCount > 1000'
        );
        feeRefundBlockCount = feeRefundBlockCount_;
        emit FeeRefundBlockCountUpdated(feeRefundBlockCount_);
    }

    /**
     * @dev Delegates stake to a validator.
     */
    function stake() external payable {
        _rawDelegate(msg.sender, msg.sender, msg.value);
        emit Delegate(msg.sender, msg.value);
    }

    /**
     * @dev Delegates stake for another address.
     * @param delegator The address that receives payback quota credit.
     */
    function stakeFor(address delegator) external payable {
        require(delegator != address(0), 'Delegator: zero address');
        _rawDelegate(msg.sender, delegator, msg.value);
        emit Delegate(delegator, msg.value);
        emit StakeFor(msg.sender, delegator, msg.value);
    }

    /**
     * @dev Undelegates stake from a validator.
     * @param amount The amount of stake to undelegate.
     */
    function unstake(uint256 amount) external returns (uint256 wrID) {
        return _unstakeFor(msg.sender, amount);
    }

    function unstakeFor(address delegator, uint256 amount)
        external
        returns (uint256 wrID)
    {
        require(delegator != address(0), 'Delegator: zero address');
        return _unstakeFor(delegator, amount);
    }

    function _unstakeFor(address delegator, uint256 amount)
        internal
        returns (uint256 wrID)
    {
        require(amount > 0, 'zero amount');
        if (msg.sender == delegator) {
            require(
                getStake[delegator] - getExternallyFundedStake[delegator] >=
                    amount,
                'Not enough stake'
            );
        } else {
            require(
                getFundedStake[msg.sender][delegator] >= amount,
                'Not enough stake'
            );
        }

        wrID = _generateWithdrawalRequestId();
        uint256 unlockTime = block.timestamp + holdTime;

        _rawUndelegate(msg.sender, delegator, amount);

        getWithdrawalRequest[msg.sender][wrID] = WithdrawalRequest({
            id: wrID,
            time: block.timestamp,
            amount: amount,
            unlockTime: unlockTime,
            completed: false
        });
        getWithdrawalRequestDelegator[msg.sender][wrID] = delegator;

        _activeWithdrawalRequestIDs[msg.sender].add(wrID);

        emit Undelegated(delegator, amount, wrID);
        emit UndelegatedFor(msg.sender, delegator, amount, wrID);

        return wrID;
    }

    /**
     * @dev Sets the minimum stake.
     * @param _minStake The new minimum stake.
     */
    function setMinStake(uint256 _minStake) external onlyOwner {
        require(_minStake >= MIN_MIN_STAKE, 'MinStake must be at least 1');
        require(_minStake <= MAX_MIN_STAKE, 'MinStake must be at most 10^30');
        minStake = _minStake;
        emit MinStakeUpdated(_minStake);
    }

    /**
     * @dev Sets the time for funds to be locked.
     * @param _holdTime The new hold time.
     */
    function setHoldTime(uint256 _holdTime) external onlyOwner {
        require(_holdTime >= MIN_HOLD_TIME, 'HoldTime must be at least 1');
        require(_holdTime <= MAX_HOLD_TIME, 'HoldTime must be at most 10^9');
        holdTime = _holdTime;
        emit HoldTimeUpdated(_holdTime);
    }

    /**
     * @dev Executes the withdrawal of staked funds for a delegator.
     * @param wrID The withdrawal request ID.
     */
    function withdrawStake(uint256 wrID) external {
        WithdrawalRequest storage request = getWithdrawalRequest[msg.sender][
            wrID
        ];
        uint256 amount = request.amount;

        require(amount > 0, 'No funds to withdraw');
        require(
            block.timestamp >= request.unlockTime,
            'Funds are still locked'
        );
        require(!request.completed, 'Funds already withdrawn');

        request.completed = true;
        completedWithdrawalRequestIDs[msg.sender].push(wrID);

        _activeWithdrawalRequestIDs[msg.sender].remove(wrID);

        address delegator = getWithdrawalRequestDelegator[msg.sender][wrID];
        if (delegator == address(0)) {
            delegator = msg.sender;
        }

        emit Withdrawn(msg.sender, amount, wrID);
        emit WithdrawnFor(msg.sender, delegator, amount, wrID);

        (bool sent, ) = msg.sender.call{value: amount}('');
        require(sent, 'Failed to send Ether');
    }

    /**
     * @dev Sets the quota factor.
     * @param _quotaFactor The new quota factor.
     */
    function setQuotaFactor(uint256 _quotaFactor) external onlyOwner {
        require(_quotaFactor >= MIN_QUOTA_FACTOR, 'QuotaFactor < 10^3');
        require(_quotaFactor <= MAX_QUOTA_FACTOR, 'QuotaFactor > 10^18');
        quotaFactor = _quotaFactor;
        emit QuotaFactorUpdated(_quotaFactor);
    }

    /**
     * @dev Returns wrIDs withdrawal requests for a staker.
     * @param staker The address that owns the withdrawal requests.
     * @param offset Offset to start with
     * @param limit Return size limit
     * @return wrIDs and values of withdrawal requests.
     */
    function getActiveWrRequests(
        address staker,
        uint256 offset,
        uint256 limit
    ) external view returns (WithdrawalRequest[] memory) {
        WithdrawalRequest[] memory requests = new WithdrawalRequest[](limit);
        for (uint256 i = 0; i < limit; ) {
            uint256 wrID = _activeWithdrawalRequestIDs[staker].at(i + offset);
            requests[i] = getWithdrawalRequest[staker][wrID];
            unchecked {
                ++i;
            }
        }
        return requests;
    }

    /**
     * @dev Returns the active withdrawal request IDs for a user.
     * @param staker The address that owns the withdrawal requests.
     * @param offset Offset to start with
     * @param limit Return size limit
     * @return The active withdrawal request IDs for the user.
     */
    function getActiveWithdrawalRequestIDs(
        address staker,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](limit);
        for (uint256 i = 0; i < limit; ) {
            ids[i] = _activeWithdrawalRequestIDs[staker].at(i + offset);
            unchecked {
                ++i;
            }
        }

        return ids;
    }

    /**
     * @dev Gets the number of _activeWithdrawalRequestIDs by staker.
     * @param staker Staker address
     */
    function getNumberOfActiveWithdrawalRequestIDs(address staker)
        external
        view
        returns (uint256)
    {
        return _activeWithdrawalRequestIDs[staker].length();
    }

    /**
     * @dev Checks if a withdrawal request ID is active for a staker.
     * @param staker The address that owns the withdrawal request.
     * @param wrID The withdrawal request ID.
     * @return True if the withdrawal request ID is active for the delegator, otherwise false.
     */
    function hasActiveWithdrawalRequestId(address staker, uint256 wrID)
        external
        view
        returns (bool)
    {
        return _activeWithdrawalRequestIDs[staker].contains(wrID);
    }

    /**
     * @dev Returns the completed withdrawal request IDs for a user.
     * @param staker The address that owns the withdrawal requests.
     * @param offset Offset to start with
     * @param limit Return size limit
     * @return The completed withdrawal request IDs for the user.
     */
    function getCompletedWrRequests(
        address staker,
        uint256 offset,
        uint256 limit
    ) external view returns (WithdrawalRequest[] memory) {
        WithdrawalRequest[] memory requests = new WithdrawalRequest[](limit);
        for (uint256 i = 0; i < limit; ) {
            uint256 wrID = completedWithdrawalRequestIDs[staker][i + offset];
            requests[i] = getWithdrawalRequest[staker][wrID];
            unchecked {
                ++i;
            }
        }
        return requests;
    }

    /**
     * @dev Gets the number of completed withdrawal request IDs by staker.
     * @param staker Staker address
     */
    function getNumberOfCompletedWithdrawalRequestIDs(address staker)
        external
        view
        returns (uint256)
    {
        return completedWithdrawalRequestIDs[staker].length;
    }

    /**
     * @dev Delegates stake to a validator.
     * @param delegator The address of the delegator.
     * @param amount The amount of stake to delegate.
     */
    function _rawDelegate(
        address staker,
        address delegator,
        uint256 amount
    ) internal {
        require(amount > 0, 'zero amount');

        getFundedStake[staker][delegator] += amount;
        if (staker != delegator) {
            getExternallyFundedStake[delegator] += amount;
        }
        getStake[delegator] += amount;
        totalStake += amount;
    }

    /**
     * @dev Undelegates stake from a validator.
     * @param delegator The address of the delegator.
     * @param amount The amount of stake to undelegate.
     */
    function _rawUndelegate(
        address staker,
        address delegator,
        uint256 amount
    ) internal {
        uint256 fundedStake = getFundedStake[staker][delegator];
        if (fundedStake >= amount) {
            getFundedStake[staker][delegator] = fundedStake - amount;
        } else {
            getFundedStake[staker][delegator] = 0;
        }
        if (staker != delegator) {
            getExternallyFundedStake[delegator] -= amount;
        }
        getStake[delegator] -= amount;
        totalStake -= amount;
    }

    /**
     * @dev Returns the generated withdrawal request ID.
     * @return The generated withdrawal request ID.
     */
    function _generateWithdrawalRequestId() internal returns (uint256) {
        return ++withdrawalRequestIdCounter;
    }
}
