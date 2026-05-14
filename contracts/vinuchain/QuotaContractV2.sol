// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';

/**
 * @title QuotaContract V2
 * @dev Non-proxy successor to the upgradeable QuotaContract. The original
 *      proxy at 0x824B93dE7221cf8a35FBd29d5202f6eFa3A29C5D (testnet) and
 *      0x1c4269fbbd4a8254f69383eef6af720bcd0acda6 (mainnet) is administered
 *      by a ProxyAdmin whose owner EOA key was lost; this redeploy escapes
 *      that trap and adds stakeFor(address) for third-party staking.
 *
 *      VinuChain node ABI surface (queried via static EVM calls from
 *      payback/payback_cache.go and payback/payback_rpc.go):
 *        - getStake(address)        -> uint256
 *        - totalStake()             -> uint256
 *        - feeRefundBlockCount()    -> uint16
 *        - minStake()               -> uint256
 *        - quotaFactor()            -> uint256
 *      Selectors recognised by gossip/payback as staking txs:
 *        - stake()                  payable
 *        - stakeFor(address)        payable
 *        - unstake(uint256)         returns (wrID)
 *      Storage layout, function selectors, and event signatures match V1
 *      so explorers, indexers, and the node treat the new contract as a
 *      drop-in successor. The only intentional difference is removal of
 *      Initializable / OwnableUpgradeable (replaced with constructor-set
 *      Ownable) so there is no proxy and no ProxyAdmin to lose keys for.
 */
contract QuotaContractV2 is Ownable {
    using EnumerableSet for EnumerableSet.UintSet;

    struct WithdrawalRequest {
        uint256 id;
        uint256 time;
        uint256 amount;
        uint256 unlockTime;
        bool completed;
    }

    uint256 public constant MIN_HOLD_TIME = 1;
    // 90 days. V1's MAX_HOLD_TIME was 10^9 sec (~31.7 years) — that ceiling
    // had no operational justification and meant a compromised owner key
    // could setHoldTime(MAX) and effectively freeze every new unstake
    // request's withdrawStake path. 90 days is comfortably above V1's
    // live setting of 7 days, leaves headroom for protocol-policy changes,
    // and caps owner-key-compromise blast radius to a known horizon.
    uint256 public constant MAX_HOLD_TIME = 90 * 24 * 60 * 60;
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

    event FeeRefundBlockCountUpdated(uint16 indexed newFeeRefundBlockCount);
    event MinStakeUpdated(uint256 indexed newMinStake);
    event HoldTimeUpdated(uint256 indexed newHoldTime);
    event QuotaFactorUpdated(uint256 indexed newQuotaFactor);
    event Delegate(address indexed delegator, uint256 amount);
    event Undelegated(
        address indexed delegator,
        uint256 amount,
        uint256 indexed wrID
    );
    event Withdrawn(
        address indexed delegator,
        uint256 amount,
        uint256 indexed wrID
    );

    constructor(
        address owner_,
        uint16 _feeRefundBlockCount,
        uint256 _minStake,
        uint256 _quotaFactor,
        uint256 _holdTime
    ) {
        require(owner_ != address(0), 'Owner: zero address');
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

        _transferOwnership(owner_);

        feeRefundBlockCount = _feeRefundBlockCount;
        minStake = _minStake;
        quotaFactor = _quotaFactor;
        holdTime = _holdTime;
    }

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

    function stake() external payable {
        _rawDelegate(msg.sender, msg.value);
        emit Delegate(msg.sender, msg.value);
    }

    /**
     * @dev Stake on behalf of another address. Credits `delegator` with the
     *      stake balance; msg.sender supplies the funds. Recognised by the
     *      VinuChain node as a stake-type transaction (see
     *      payback/payback_cache.go stakeForSelector).
     */
    function stakeFor(address delegator) external payable {
        require(delegator != address(0), 'Delegator: zero address');
        _rawDelegate(delegator, msg.value);
        emit Delegate(delegator, msg.value);
    }

    function unstake(uint256 amount) external returns (uint256 wrID) {
        require(amount > 0, 'zero amount');
        require(getStake[msg.sender] >= amount, 'Not enough stake');

        wrID = _generateWithdrawalRequestId();
        uint256 unlockTime = block.timestamp + holdTime;

        _rawUndelegate(msg.sender, amount);

        getWithdrawalRequest[msg.sender][wrID] = WithdrawalRequest({
            id: wrID,
            time: block.timestamp,
            amount: amount,
            unlockTime: unlockTime,
            completed: false
        });

        _activeWithdrawalRequestIDs[msg.sender].add(wrID);

        emit Undelegated(msg.sender, amount, wrID);

        return wrID;
    }

    function setMinStake(uint256 _minStake) external onlyOwner {
        require(_minStake >= MIN_MIN_STAKE, 'MinStake must be at least 1');
        require(_minStake <= MAX_MIN_STAKE, 'MinStake must be at most 10^30');
        minStake = _minStake;
        emit MinStakeUpdated(_minStake);
    }

    function setHoldTime(uint256 _holdTime) external onlyOwner {
        require(_holdTime >= MIN_HOLD_TIME, 'HoldTime must be at least 1');
        require(_holdTime <= MAX_HOLD_TIME, 'HoldTime must be at most 10^9');
        holdTime = _holdTime;
        emit HoldTimeUpdated(_holdTime);
    }

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

        emit Withdrawn(msg.sender, amount, wrID);

        (bool sent, ) = msg.sender.call{value: amount}('');
        require(sent, 'Failed to send Ether');
    }

    function setQuotaFactor(uint256 _quotaFactor) external onlyOwner {
        require(_quotaFactor >= MIN_QUOTA_FACTOR, 'QuotaFactor < 10^3');
        require(_quotaFactor <= MAX_QUOTA_FACTOR, 'QuotaFactor > 10^18');
        quotaFactor = _quotaFactor;
        emit QuotaFactorUpdated(_quotaFactor);
    }

    function getActiveWrRequests(
        address delegator,
        uint256 offset,
        uint256 limit
    ) external view returns (WithdrawalRequest[] memory) {
        WithdrawalRequest[] memory requests = new WithdrawalRequest[](limit);
        for (uint256 i = 0; i < limit; ) {
            uint256 wrID = _activeWithdrawalRequestIDs[delegator].at(
                i + offset
            );
            requests[i] = getWithdrawalRequest[delegator][wrID];
            unchecked {
                ++i;
            }
        }
        return requests;
    }

    function getActiveWithdrawalRequestIDs(
        address delegator,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256[] memory ids = new uint256[](limit);
        for (uint256 i = 0; i < limit; ) {
            ids[i] = _activeWithdrawalRequestIDs[delegator].at(i + offset);
            unchecked {
                ++i;
            }
        }
        return ids;
    }

    function getNumberOfActiveWithdrawalRequestIDs(address delegator)
        external
        view
        returns (uint256)
    {
        return _activeWithdrawalRequestIDs[delegator].length();
    }

    function hasActiveWithdrawalRequestId(address delegator, uint256 wrID)
        external
        view
        returns (bool)
    {
        return _activeWithdrawalRequestIDs[delegator].contains(wrID);
    }

    function getCompletedWrRequests(
        address delegator,
        uint256 offset,
        uint256 limit
    ) external view returns (WithdrawalRequest[] memory) {
        WithdrawalRequest[] memory requests = new WithdrawalRequest[](limit);
        for (uint256 i = 0; i < limit; ) {
            uint256 wrID = completedWithdrawalRequestIDs[delegator][i + offset];
            requests[i] = getWithdrawalRequest[delegator][wrID];
            unchecked {
                ++i;
            }
        }
        return requests;
    }

    function getNumberOfCompletedWithdrawalRequestIDs(address delegator)
        external
        view
        returns (uint256)
    {
        return completedWithdrawalRequestIDs[delegator].length;
    }

    function _rawDelegate(address delegator, uint256 amount) internal {
        require(amount > 0, 'zero amount');

        getStake[delegator] += amount;
        totalStake += amount;
    }

    function _rawUndelegate(address delegator, uint256 amount) internal {
        getStake[delegator] -= amount;
        totalStake -= amount;
    }

    function _generateWithdrawalRequestId() internal returns (uint256) {
        return ++withdrawalRequestIdCounter;
    }
}
