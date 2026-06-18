// SPDX-License-Identifier: MIT
pragma solidity ^0.8.6;

import "@openzeppelin/contracts/utils/math/Math.sol";
// import "hardhat/console.sol";

/// [MIT License]
library StringUtils {
    function utfLength(bytes1 b) internal pure returns (uint8) {
        if (b < 0x80) {
            return 1;
        } else if(b < 0xE0) {
            return 2;
        } else if(b < 0xF0) {
            return 3;
        } else if(b < 0xF8) {
            return 4;
        } else if(b < 0xFC) {
            return 5;
        } else {
            return 6;
        }
    }

    function firstN(bytes memory arr, uint256 n) internal pure returns (bytes memory) {
        uint256 length = Math.min(n, arr.length);
        bytes memory newArray = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            newArray[i] = arr[i];
        }

        return newArray;
    }

    function insertBeforeAscii(bytes memory str, bytes1 target, bytes1 insert) internal pure returns (bytes memory) {
        // You can't insert something before a prefix byte (you technically could, but it would be really counter-intuitive)
        require(utfLength(target) == 1, "StringUtils: target must be ASCII");
        require(utfLength(insert) == 1, "StringUtils: insert must be ASCII");

        for (uint256 i = 0; i < str.length; i++) {
            if (utfLength(str[i]) + i > str.length) {
                revert("StringUtils: not a valid UTF-8 string");
            }
        }

        bytes memory newString = new bytes(str.length * 2);
        uint256 from = 0;
        uint256 to = 0;
        while (from < str.length) {
            bytes1 b = str[from];
            uint8 bLength = utfLength(b);

            if (bLength == 1 && b == target) {
                // ASCII character that matches our target
                newString[to] = insert;
                to++;
            }

            for (uint8 j = 0; j < bLength; j++) {
                newString[to + j] = str[from + j];
            }

            to += bLength;
            from += bLength;
        }

        return firstN(newString, to);
    }

    function insertBeforeAsciiString(string memory str, bytes1 target, bytes1 insert) internal pure returns (string memory) {
        return string(insertBeforeAscii(bytes(str), target, insert));
    }
}