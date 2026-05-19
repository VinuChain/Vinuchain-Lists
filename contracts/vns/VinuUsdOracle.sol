//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VinuUsdOracle is Ownable {
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard upper bound on `maxChangeBps`. Owner cannot widen the per-update
    ///         change tolerance beyond 20% in a single tx. Walking it higher requires
    ///         multiple monitorable txs over time.
    uint256 public constant MAX_CHANGE_BPS_CEILING = 2_000;

    /// @notice Hard upper bound on `maxAge`. Owner cannot extend the staleness window
    ///         beyond 12 hours in a single tx. Forces a slow-walk to disable freshness.
    uint256 public constant MAX_AGE_CEILING = 12 hours;

    /// @notice Hard multiplier on bounds widening per tx. New width may not exceed
    ///         2x prior width. First-time bounds-set (uninitialized state) is exempt.
    uint256 public constant BOUNDS_WIDEN_FACTOR_CEILING = 2;

    int256 private answer;

    uint8 public constant decimals = 8;
    string public constant description = "VC / USD";
    uint256 public constant version = 1;

    uint256 public maxAge;
    uint256 public minAnswer;
    uint256 public maxAnswer;
    uint256 public maxChangeBps;
    uint256 public updatedAt;
    string public source;

    event AnswerUpdated(int256 indexed current, string source, uint256 updatedAt);
    event BoundsUpdated(uint256 minAnswer, uint256 maxAnswer);
    event MaxChangeBpsUpdated(uint256 maxChangeBps);
    event MaxAgeUpdated(uint256 maxAge);

    error AnswerChangeTooLarge(uint256 previousAnswer, uint256 newAnswer);
    error AnswerOutOfBounds(uint256 answer, uint256 minAnswer, uint256 maxAnswer);
    error InvalidAnswer();
    error InvalidBounds();
    error InvalidMaxChangeBps();
    error InvalidMaxAge();
    error MaxChangeBpsAboveCeiling(uint256 newMaxChangeBps, uint256 ceiling);
    error MaxAgeAboveCeiling(uint256 newMaxAge, uint256 ceiling);
    error BoundsWidenedTooMuch(uint256 newWidth, uint256 priorWidth, uint256 ceiling);
    error SourceTooLong();
    error StaleAnswer(uint256 updatedAt, uint256 maxAge);

    constructor(
        int256 initialAnswer,
        string memory initialSource,
        uint256 initialMaxAge,
        uint256 initialMinAnswer,
        uint256 initialMaxAnswer,
        uint256 initialMaxChangeBps
    ) {
        _setMaxAge(initialMaxAge);
        _setBounds(initialMinAnswer, initialMaxAnswer);
        _setMaxChangeBps(initialMaxChangeBps);
        _setAnswer(initialAnswer, initialSource);
    }

    function setLatestAnswer(
        int256 newAnswer,
        string calldata newSource
    ) external onlyOwner {
        _setAnswer(newAnswer, newSource);
    }

    function setMaxAge(uint256 newMaxAge) external onlyOwner {
        _setMaxAge(newMaxAge);
    }

    function setBounds(
        uint256 newMinAnswer,
        uint256 newMaxAnswer
    ) external onlyOwner {
        _setBounds(newMinAnswer, newMaxAnswer);

        if (answer > 0) {
            _requireAnswerInBounds(uint256(answer));
        }
    }

    function setMaxChangeBps(uint256 newMaxChangeBps) external onlyOwner {
        _setMaxChangeBps(newMaxChangeBps);
    }

    function latestAnswer() external view returns (int256) {
        if (block.timestamp > updatedAt + maxAge) {
            revert StaleAnswer(updatedAt, maxAge);
        }
        return answer;
    }

    function latestStoredAnswer() external view returns (int256) {
        return answer;
    }

    function _setAnswer(int256 newAnswer, string memory newSource) internal {
        if (newAnswer <= 0) revert InvalidAnswer();
        if (bytes(newSource).length > 32) revert SourceTooLong();

        uint256 unsignedAnswer = uint256(newAnswer);
        _requireAnswerInBounds(unsignedAnswer);
        if (answer > 0) {
            uint256 previousAnswer = uint256(answer);
            uint256 delta = previousAnswer > unsignedAnswer
                ? previousAnswer - unsignedAnswer
                : unsignedAnswer - previousAnswer;
            if (delta * BPS_DENOMINATOR > previousAnswer * maxChangeBps) {
                revert AnswerChangeTooLarge(previousAnswer, unsignedAnswer);
            }
        }

        answer = newAnswer;
        source = newSource;
        updatedAt = block.timestamp;

        emit AnswerUpdated(newAnswer, newSource, block.timestamp);
    }

    function _setBounds(
        uint256 newMinAnswer,
        uint256 newMaxAnswer
    ) internal {
        if (newMinAnswer == 0 || newMaxAnswer < newMinAnswer) {
            revert InvalidBounds();
        }

        // Walk-the-rails guard: cap widening to BOUNDS_WIDEN_FACTOR_CEILING x prior
        // width per tx. Exempt the first-set case (uninitialized state has
        // minAnswer == 0). Owner can still ratchet bounds open across multiple txs.
        if (minAnswer != 0) {
            uint256 priorWidth = maxAnswer - minAnswer;
            uint256 newWidth = newMaxAnswer - newMinAnswer;
            uint256 ceiling = priorWidth * BOUNDS_WIDEN_FACTOR_CEILING;
            if (newWidth > ceiling) {
                revert BoundsWidenedTooMuch(newWidth, priorWidth, ceiling);
            }
        }

        minAnswer = newMinAnswer;
        maxAnswer = newMaxAnswer;
        emit BoundsUpdated(newMinAnswer, newMaxAnswer);
    }

    function _setMaxChangeBps(uint256 newMaxChangeBps) internal {
        if (newMaxChangeBps == 0 || newMaxChangeBps > BPS_DENOMINATOR) {
            revert InvalidMaxChangeBps();
        }
        if (newMaxChangeBps > MAX_CHANGE_BPS_CEILING) {
            revert MaxChangeBpsAboveCeiling(newMaxChangeBps, MAX_CHANGE_BPS_CEILING);
        }

        maxChangeBps = newMaxChangeBps;
        emit MaxChangeBpsUpdated(newMaxChangeBps);
    }

    function _setMaxAge(uint256 newMaxAge) internal {
        if (newMaxAge < 1 hours || newMaxAge > 7 days) {
            revert InvalidMaxAge();
        }
        if (newMaxAge > MAX_AGE_CEILING) {
            revert MaxAgeAboveCeiling(newMaxAge, MAX_AGE_CEILING);
        }

        maxAge = newMaxAge;
        emit MaxAgeUpdated(newMaxAge);
    }

    function _requireAnswerInBounds(uint256 checkedAnswer) internal view {
        if (checkedAnswer < minAnswer || checkedAnswer > maxAnswer) {
            revert AnswerOutOfBounds(checkedAnswer, minAnswer, maxAnswer);
        }
    }
}
