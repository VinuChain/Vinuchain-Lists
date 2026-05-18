//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VinuUsdOracle is Ownable {
    int256 private answer;

    uint8 public constant decimals = 8;
    string public constant description = "VC / USD";
    uint256 public constant version = 1;

    uint256 public maxAge;
    uint256 public updatedAt;
    string public source;

    event AnswerUpdated(int256 indexed current, string source, uint256 updatedAt);
    event MaxAgeUpdated(uint256 maxAge);

    error InvalidAnswer();
    error InvalidMaxAge();
    error SourceTooLong();
    error StaleAnswer(uint256 updatedAt, uint256 maxAge);

    constructor(
        int256 initialAnswer,
        string memory initialSource,
        uint256 initialMaxAge
    ) {
        _setMaxAge(initialMaxAge);
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

        answer = newAnswer;
        source = newSource;
        updatedAt = block.timestamp;

        emit AnswerUpdated(newAnswer, newSource, block.timestamp);
    }

    function _setMaxAge(uint256 newMaxAge) internal {
        if (newMaxAge < 1 hours || newMaxAge > 7 days) {
            revert InvalidMaxAge();
        }

        maxAge = newMaxAge;
        emit MaxAgeUpdated(newMaxAge);
    }
}
