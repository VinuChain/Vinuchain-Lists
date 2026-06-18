// SPDX-License-Identifier: MIT
pragma solidity ^0.8.6;

import "@openzeppelin/contracts/access/Ownable.sol";

contract NFTCommissions is Ownable {
    uint16 public platformFeePercentage = 500; //two decimals, so 500 = 5.00%
    address public commissionAccount;

    uint256 public lock = 0;
    uint16 public newPlatformFeePercentage = 0;
    uint256 public constant PLATFORM_FEE_TIMELOCK = 7 days;

    constructor(address _commissionAccount) Ownable(msg.sender) {
        commissionAccount = _commissionAccount;
    }

    function setCommissionAccount(address _commissionAccount) public onlyOwner {
        commissionAccount = _commissionAccount;
    }

    function decreasePlatformFeePercentage(uint16 _lowerFeePercentage) public onlyOwner {
        require(_lowerFeePercentage < platformFeePercentage, "NFTCommissions: _lowerFeePercentage must be lower than the current platform fee percentage");
        platformFeePercentage = _lowerFeePercentage;
    }

    function requestPlatformFeePercentageIncrease(uint16 _higherFeePercentage) public onlyOwner {
        require(_higherFeePercentage > platformFeePercentage, "NFTCommissions: _higherFeePercentage must be higher than the current platform fee percentage");
        lock = block.timestamp + PLATFORM_FEE_TIMELOCK;
        newPlatformFeePercentage = _higherFeePercentage;
    }

    function applyPlatformFeePercentageIncrease() public onlyOwner {
        require(lock != 0, "NFTCommissions: platform fee percentage increase must be first requested");
        require(block.timestamp >= lock, "NFTCommissions: platform fee percentage increase is locked");
        lock = 0;
        platformFeePercentage = newPlatformFeePercentage;
        newPlatformFeePercentage = 0;
    }
}