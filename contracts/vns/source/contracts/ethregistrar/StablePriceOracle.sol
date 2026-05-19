//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import "./IPriceOracle.sol";
import "../utils/StringUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface AggregatorInterface {
    function latestAnswer() external view returns (int256);
}

// StablePriceOracle stores the owner-governed USD rent curve and converts it
// into the enforced native VC payment amount with the current VC/USD oracle.
contract StablePriceOracle is IPriceOracle, Ownable {
    using StringUtils for *;

    // USD rent in attoUSD per second by label length.
    uint256 public price1Letter;
    uint256 public price2Letter;
    uint256 public price3Letter;
    uint256 public price4Letter;
    uint256 public price5Letter;

    // Oracle address
    AggregatorInterface public immutable usdOracle;

    event RentPriceChanged(uint256[] prices);

    error InvalidRentPrices();

    constructor(AggregatorInterface _usdOracle, uint256[] memory _rentPrices) {
        usdOracle = _usdOracle;
        _setRentPrices(_rentPrices);
    }

    function setRentPrices(
        uint256[] calldata _rentPrices
    ) external onlyOwner {
        _setRentPrices(_rentPrices);
    }

    function _setRentPrices(uint256[] memory _rentPrices) internal {
        if (_rentPrices.length != 5) revert InvalidRentPrices();

        price1Letter = _rentPrices[0];
        price2Letter = _rentPrices[1];
        price3Letter = _rentPrices[2];
        price4Letter = _rentPrices[3];
        price5Letter = _rentPrices[4];

        emit RentPriceChanged(_rentPrices);
    }

    function price(
        string calldata name,
        uint256 expires,
        uint256 duration
    ) external view override returns (IPriceOracle.Price memory) {
        uint256 len = name.strlen();
        uint256 basePrice;

        if (len >= 5) {
            basePrice = price5Letter * duration;
        } else if (len == 4) {
            basePrice = price4Letter * duration;
        } else if (len == 3) {
            basePrice = price3Letter * duration;
        } else if (len == 2) {
            basePrice = price2Letter * duration;
        } else {
            basePrice = price1Letter * duration;
        }

        return
            IPriceOracle.Price({
                base: attoUSDToWei(basePrice),
                premium: attoUSDToWei(_premium(name, expires, duration))
            });
    }

    /// @dev Returns the pricing premium in wei.
    function premium(
        string calldata name,
        uint256 expires,
        uint256 duration
    ) external view returns (uint256) {
        return attoUSDToWei(_premium(name, expires, duration));
    }

    /// @dev Returns the pricing premium in internal base units.
    function _premium(
        string memory,
        uint256,
        uint256
    ) internal view virtual returns (uint256) {
        return 0;
    }

    function attoUSDToWei(uint256 amount) internal view returns (uint256) {
        uint256 ethPrice = uint256(usdOracle.latestAnswer());
        return (amount * 1e8) / ethPrice;
    }

    function weiToAttoUSD(uint256 amount) internal view returns (uint256) {
        uint256 ethPrice = uint256(usdOracle.latestAnswer());
        return (amount * ethPrice) / 1e8;
    }

    function supportsInterface(
        bytes4 interfaceID
    ) public view virtual returns (bool) {
        return
            interfaceID == type(IERC165).interfaceId ||
            interfaceID == type(IPriceOracle).interfaceId;
    }
}
