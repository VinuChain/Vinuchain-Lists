// SPDX-License-Identifier: MIT
pragma solidity ^0.8.6;
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/interfaces/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./NFTCommissions.sol";

contract Marketplace is Pausable, Ownable, NFTCommissions, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes4 private constant _INTERFACE_ID_ERC2981 = 0x2a55205a;

    int256 MAX_AMOUNT = 2**255 - 1; // Maximum value that can be stored in an int256

    event TokenListed(
        IERC1155 indexed _nftAddress,
        uint256 indexed _tokenId,
        address indexed _seller,
        uint256 _listingId,
        uint256 amount,
        IERC20 _paymentToken,
        uint256 _price
    );

    event TokenDelisted(
        IERC1155 indexed _nftAddress,
        uint256 indexed _tokenId,
        address indexed _seller,
        uint256 _listingId
    );

    event TokenPurchased(
        IERC1155 indexed _nftAddress,
        uint256 indexed _tokenId,
        address indexed _seller,
        address _buyer,
        uint256 _listingId,
        uint256 _amount,
        IERC20 _paymentToken,
        uint256 _price
    );

    struct Listing {
        IERC20 paymentToken;
        uint256 price;
        address seller;
        uint256 amount;
    }

    // (nftAddress => (tokenId => (listingId => Listing))) mapping
    mapping(IERC1155 => mapping(uint256 => mapping(uint256 => Listing))) public listings;
    mapping(IERC1155 => mapping(uint256 => uint256)) public listingCount;

    constructor(address _commissionAccount) NFTCommissions(_commissionAccount) {

    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getListing(IERC1155 _nftAddress, uint256 _tokenId, uint256 _listingId) external view returns (Listing memory) {
        return listings[_nftAddress][_tokenId][_listingId];
    }

    function listToken(IERC1155 _nftAddress, uint256 _tokenId, IERC20 _paymentToken, uint256 _price, uint256 _amount) external whenNotPaused nonReentrant {
        // require(_nftAddress.exists(_tokenId), "Marketplace: token does not exist"); // Opt., uses non-standard method
        require(_nftAddress.isApprovedForAll(msg.sender, address(this)), "Marketplace: Marketplace contract is not approved");
        require(_amount <= _nftAddress.balanceOf(msg.sender, _tokenId), "Marketplace: not enough tokens to list");
        require(_amount > 0, "Marketplace: amount must be greater than 0");
        require(_amount <= uint256(MAX_AMOUNT), "Marketplace: amount must be less than or equal to MAX_AMOUNT");
        require(_price > 0, "Marketplace: price must be greater than 0");

        uint256 listingId = listingCount[_nftAddress][_tokenId];
        listings[_nftAddress][_tokenId][listingId] = Listing(_paymentToken, _price, msg.sender, _amount);
        listingCount[_nftAddress][_tokenId]++;
        emit TokenListed(_nftAddress, _tokenId, msg.sender, listingId, _amount, _paymentToken, _price);
    }
    
    function editListing(IERC1155 _nftAddress, uint256 _tokenId, uint256 _listingId, uint256 _price, int256 _amount, int256 _expectedAmount) external whenNotPaused nonReentrant {
        // require(_nftAddress.exists(_tokenId), "Marketplace: token does not exist"); // Opt., uses non-standard method
        require(listings[_nftAddress][_tokenId][_listingId].seller == msg.sender, "Marketplace: can only edit own listings");
        require(_nftAddress.isApprovedForAll(msg.sender, address(this)), "Marketplace: Marketplace contract is not approved");
        // require(_listingId < listingCount[_nftAddress][_tokenId], "Marketplace: listing ID out of bounds"); // Opt.
        require(_amount == -1 || _amount <= int256(_nftAddress.balanceOf(msg.sender, _tokenId)), "Marketplace: not enough tokens to list");
        require(_amount > 0 || _amount == -1, "Marketplace: amount must be greater than 0 or equal to -1 for no change");
        // Somewhat redundant, since MAX_AMOUNT is the maximum value that can be stored in an int256
        require(_amount <= MAX_AMOUNT, "Marketplace: amount must be less than or equal to MAX_AMOUNT");
        require(_price > 0, "Marketplace: price must be greater than 0");

        //require(listings[_nftAddress][_tokenId][_listingId].seller != address(0), "Marketplace: listing does not exist"); // Opt.
        if (_expectedAmount != -1) {
            require(_expectedAmount >= 0, "Marketplace: expected amount must be greater than or equal to 0, or -1 for no check");
            require(listings[_nftAddress][_tokenId][_listingId].amount == uint256(_expectedAmount), "Marketplace: expected amount does not match");
        }

        if (_amount == -1) {
            _amount = int256(listings[_nftAddress][_tokenId][_listingId].amount);
        }

        IERC20 paymentToken = listings[_nftAddress][_tokenId][_listingId].paymentToken;

        listings[_nftAddress][_tokenId][_listingId] = Listing(paymentToken, _price, msg.sender, uint256(_amount));
        emit TokenListed(_nftAddress, _tokenId, msg.sender, _listingId, uint256(_amount), paymentToken, _price);
    }

    function delistToken(IERC1155 _nftAddress, uint256 _tokenId, uint256 _listingId) external nonReentrant {
        // require(_nftAddress.exists(_tokenId), "Marketplace: token does not exist"); // Opt., uses non-standard method
        require(listings[_nftAddress][_tokenId][_listingId].seller == msg.sender, "Marketplace: can only delist own listings");
        // require(_nftAddress.isApprovedForAll(msg.sender, address(this)), "Marketplace: Marketplace contract is not approved");
        // require(_listingId < listingCount[_nftAddress][_tokenId], "Marketplace: listing ID out of bounds"); // Opt.
        // require(listings[_nftAddress][_tokenId][_listingId].seller != address(0), "Marketplace: cannot interact with a delisted listing"); // Opt.

        _delistToken(_nftAddress, _tokenId, _listingId);
    }

    function _removeListing(IERC1155 _nftAddress, uint256 _tokenId, uint256 _listingId) private {
        delete listings[_nftAddress][_tokenId][_listingId];
    }

    function _delistToken(IERC1155 _nftAddress, uint256 _tokenId, uint256 _listingId) private {
        _removeListing(_nftAddress, _tokenId, _listingId);
        emit TokenDelisted(_nftAddress, _tokenId, msg.sender, _listingId);
    }

    function _handleFunds(IERC1155 _nftAddress, uint256 _tokenId, address seller, IERC20 _paymentToken, uint256 value) private {
        uint256 platformFee = (value * platformFeePercentage) / 10000;

        uint256 remainder = value - platformFee;

        address creator;
        uint256 creatorFee;

        if (_nftAddress.supportsInterface(_INTERFACE_ID_ERC2981)) {
            (creator, creatorFee) = IERC2981(address(_nftAddress)).royaltyInfo(_tokenId, remainder);
        }

        uint256 sellerEarnings = remainder;

        if(creatorFee > 0) {
            sellerEarnings -= creatorFee;

            _paymentToken.safeTransferFrom(msg.sender, creator, creatorFee);
        }

        _paymentToken.safeTransferFrom(msg.sender, commissionAccount, platformFee);
        
        _paymentToken.safeTransferFrom(msg.sender, seller, sellerEarnings);
    }

    function buyToken(IERC1155 _nftAddress, uint256 _tokenId, uint256 _listingId, uint256 _amount, uint256 _expectedPrice) external payable whenNotPaused nonReentrant {
        // If all copies have been burned, the token is deleted, which means that a listing could have a non-existent token
        // require(_nftAddress.exists(_tokenId), "Marketplace: token does not exist"); // Opt., uses non-standard method
        require(_amount > 0, "Marketplace: _amount must be greater than 0");
        // require(_listingId < listingCount[_nftAddress][_tokenId], "Marketplace: listing index out of bounds"); // Opt.
        require(listings[_nftAddress][_tokenId][_listingId].seller != address(0), "Marketplace: cannot interact with a non-existent listing");
        require(listings[_nftAddress][_tokenId][_listingId].seller != msg.sender, "Marketplace: cannot buy from yourself");
        require(_amount <= listings[_nftAddress][_tokenId][_listingId].amount, "Marketplace: not enough tokens to buy");
        address seller = listings[_nftAddress][_tokenId][_listingId].seller;
        // If seller transfers tokens "for free", their listing is still active! If they get them back they can still be bought
        require(_amount <= _nftAddress.balanceOf(seller, _tokenId), "Marketplace: seller does not have enough tokens");

        IERC20 paymentToken = listings[_nftAddress][_tokenId][_listingId].paymentToken;
        uint256 price = listings[_nftAddress][_tokenId][_listingId].price;
        require(price <= _expectedPrice, "Marketplace: price too high");
        // check if listing is satisfied
        require(paymentToken.allowance(msg.sender, address(this)) >= price * _amount, "Marketplace: not enough allowance");

        // Update listing
        listings[_nftAddress][_tokenId][_listingId].amount -= _amount;

        // Delist a listing if all tokens have been sold
        if (listings[_nftAddress][_tokenId][_listingId].amount == 0) {
            _delistToken(_nftAddress, _tokenId, _listingId);
        }

        emit TokenPurchased(_nftAddress, _tokenId, seller, msg.sender, _listingId, _amount, paymentToken, price);

        _handleFunds(_nftAddress, _tokenId, seller, paymentToken, price * _amount);
        _nftAddress.safeTransferFrom(seller, msg.sender, _tokenId, _amount, "");
    }
}